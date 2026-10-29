import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { WorkerResponse, WorkerResult } from "./protocol.js";

export interface WorkerLaunch {
  executable: string;
  args: string[];
  cwd?: string;
}

export interface WorkerClientOptions {
  launch: (signal?: AbortSignal) => Promise<WorkerLaunch>;
  timeoutMs?: number;
  shutdownMs?: number;
  canTerminate?: () => boolean;
  onStop?: (operationId: string) => void;
}

interface Pending {
  resolve: (result: WorkerResult) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export class WorkerClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private starting: Promise<ChildProcessWithoutNullStreams> | undefined;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private disposed = false;
  private failure: Error | undefined;
  private inputActive = false;
  private retirementFailure: Error | undefined;
  private retirement: Promise<void> | undefined;
  private readonly lifetime = new AbortController();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: WorkerClientOptions) {}

  private async start(
    signal?: AbortSignal,
  ): Promise<ChildProcessWithoutNullStreams> {
    if (this.disposed) throw new Error("WORKER_DISPOSED: session has closed");
    signal?.throwIfAborted();
    if (this.retirement) await this.retirement;
    if (this.retirementFailure) throw this.retirementFailure;
    if (this.child && this.failure) await this.retire(this.failure.message);
    if (this.child) return this.child;
    const launchSignal = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    this.starting ??= abortable(this.options.launch(launchSignal), launchSignal)
      .then((launch) => {
        if (this.disposed)
          throw new Error("WORKER_DISPOSED: session has closed");
        signal?.throwIfAborted();
        const child = spawn(launch.executable, launch.args, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          cwd: launch.cwd,
        });
        this.child = child;
        let output = "";
        let diagnostic = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          diagnostic = (diagnostic + chunk).slice(-4096);
        });
        child.stdout.on("data", (chunk: string) => {
          output += chunk;
          if (output.length > 32 * 1024 * 1024) {
            this.fail(
              child,
              new Error("WORKER_PROTOCOL_ERROR: response exceeds 32 MiB"),
            );
            if (!this.inputActive && this.options.canTerminate?.() !== false)
              child.kill();
            return;
          }
          for (;;) {
            const newline = output.indexOf("\n");
            if (newline < 0) break;
            const line = output.slice(0, newline);
            output = output.slice(newline + 1);
            try {
              const response = JSON.parse(line) as WorkerResponse & {
                event?: string;
                operationId?: string;
                active?: boolean;
              };
              if (
                response.event === "input_state" &&
                typeof response.active === "boolean"
              ) {
                this.inputActive = response.active;
                continue;
              }
              if (
                response.event === "stopped" &&
                typeof response.operationId === "string"
              ) {
                this.options.onStop?.(response.operationId);
                continue;
              }
              if (
                !Number.isSafeInteger(response.id) ||
                typeof response.result?.ok !== "boolean" ||
                typeof response.result.action !== "string"
              )
                throw new Error("Invalid response");
              const pending = this.pending.get(response.id);
              if (pending) {
                this.pending.delete(response.id);
                pending.cleanup();
                pending.resolve(response.result);
              }
            } catch {
              this.fail(
                child,
                new Error("WORKER_PROTOCOL_ERROR: invalid response"),
              );
              if (!this.inputActive && this.options.canTerminate?.() !== false)
                child.kill();
            }
          }
        });
        child.once("error", (error) =>
          this.fail(
            child,
            new Error(`WORKER_START_FAILED: ${error.message}`),
            child.pid === undefined,
          ),
        );
        child.once("close", (code) =>
          this.fail(
            child,
            new Error(
              `WORKER_EXITED: code ${code}${diagnostic ? `; ${diagnostic.trim()}` : ""}`,
            ),
            true,
          ),
        );
        child.stdin.on("error", (error) =>
          this.fail(child, new Error(`WORKER_WRITE_FAILED: ${error.message}`)),
        );
        return child;
      })
      .finally(() => {
        this.starting = undefined;
      });
    return this.starting;
  }

  private fail(
    child: ChildProcessWithoutNullStreams,
    error: Error,
    confirmedExit = false,
  ): void {
    if (this.child !== child) return;
    if (confirmedExit) {
      this.child = undefined;
      this.failure = undefined;
      this.retirementFailure = undefined;
    } else this.failure = error;
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.cleanup();
      pending.reject(error);
    }
  }

  execute(
    action: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    operationId?: string,
  ): Promise<WorkerResult> {
    if (this.disposed)
      return Promise.reject(new Error("WORKER_DISPOSED: session has closed"));
    const callSignal = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    const result = this.queue
      .catch(() => undefined)
      .then(() => {
        callSignal.throwIfAborted();
        return this.executeNow(action, args, callSignal, operationId);
      });
    this.queue = result.catch(() => undefined);
    return abortable(result, callSignal);
  }

  private async executeNow(
    action: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    operationId?: string,
  ): Promise<WorkerResult> {
    const child = await this.start(signal);
    if (this.disposed) throw new Error("WORKER_DISPOSED: session has closed");
    signal?.throwIfAborted();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.fail(
            child,
            new Error(
              `WORKER_TIMEOUT: ${action} exceeded the execution deadline; input was not replayed`,
            ),
          );
          if (!this.inputActive && this.options.canTerminate?.() !== false)
            child.kill();
        },
        Math.max(
          this.options.timeoutMs ?? 30_000,
          action === "wait" &&
            Number.isSafeInteger(args.milliseconds ?? 500) &&
            Number(args.milliseconds ?? 500) >= 1 &&
            Number(args.milliseconds ?? 500) <= 30000
            ? Number(args.milliseconds ?? 500) + 2000
            : 0,
          action === "wait_for" &&
            Number.isSafeInteger(args.timeoutMs ?? 5000) &&
            Number(args.timeoutMs ?? 5000) >= 100 &&
            Number(args.timeoutMs ?? 5000) <= 60000
            ? Number(args.timeoutMs ?? 5000) + 10000
            : 0,
        ),
      );
      const abort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.cleanup();
        // Health has no held input. Cooperative input stopping is added before input tools.
        child.stdin.write(`${JSON.stringify({ cancel: id })}\n`);
        pending.reject(new Error("COMPUTER_USE_CANCELLED"));
      };
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        },
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      child.stdin.write(
        `${JSON.stringify({ id, action, args, operationId })}\n`,
        (error) => {
          if (error)
            this.fail(
              child,
              new Error(`WORKER_WRITE_FAILED: ${error.message}`),
            );
        },
      );
    });
  }

  stopOperation(operationId: string): void {
    // Control messages bypass queued calls, including a busy native provider.
    this.child?.stdin.write(`${JSON.stringify({ stop: operationId })}\n`);
  }

  async retire(reason = "WORKER_RETIRED: operation stopped"): Promise<void> {
    if (this.inputActive || this.options.canTerminate?.() === false)
      throw new Error(
        "INPUT_CLEANUP_UNCONFIRMED: active input prevents bridge retirement",
      );
    if (this.retirement) return this.retirement;
    const child = this.child;
    if (!child) return;
    this.fail(child, new Error(reason));
    this.retirement = new Promise<void>((resolve, reject) => {
      let forced: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => {
        if (this.inputActive || this.options.canTerminate?.() === false) {
          reject(
            new Error(
              "INPUT_CLEANUP_UNCONFIRMED: active input prevents bridge retirement",
            ),
          );
          return;
        }
        child.kill();
        forced = setTimeout(
          () =>
            reject(
              new Error(
                "WORKER_RETIRE_FAILED: child exit was not confirmed; desktop ownership must stay held",
              ),
            ),
          1000,
        );
      }, this.options.shutdownMs ?? 1000);
      child.once("close", () => {
        clearTimeout(timer);
        clearTimeout(forced);
        resolve();
      });
      child.stdin.end();
    });
    try {
      await this.retirement;
    } catch (error) {
      this.retirementFailure =
        error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      this.retirement = undefined;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.lifetime.abort(new Error("WORKER_DISPOSED: session has closed"));
    await this.starting?.catch(() => undefined);
    await this.retire("WORKER_DISPOSED: session has closed");
  }
}
