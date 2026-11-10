/** Shared per-call timing policy; durations are milliseconds, zero disables only a deadline. */
export const timingMilliseconds = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
};

export function milliseconds(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(
      `INVALID_ARGUMENTS: ${name} must be non-negative safe whole milliseconds`,
    );
  return Number(value);
}

export function inputTiming(
  args: Record<string, unknown>,
  requestedDurationMs: number,
  ordinaryTimeoutMs: number,
): {
  timeoutMs: number;
  deadlinePolicy: "disabled" | "explicit" | "derived" | "default";
} {
  milliseconds(requestedDurationMs, "requested duration");
  if (args.timeoutMs !== undefined) {
    const timeoutMs = milliseconds(args.timeoutMs, "timeoutMs");
    return {
      timeoutMs,
      deadlinePolicy: timeoutMs === 0 ? "disabled" : "explicit",
    };
  }
  const timeoutMs = ordinaryTimeoutMs + requestedDurationMs;
  if (!Number.isSafeInteger(timeoutMs))
    throw new Error(
      "INVALID_ARGUMENTS: derived execution duration is not representable",
    );
  return {
    timeoutMs,
    deadlinePolicy: args.holdMs !== undefined ? "derived" : "default",
  };
}

export function pressTiming(
  args: Record<string, unknown>,
  ordinaryTimeoutMs: number,
) {
  const holdMs =
    args.holdMs === undefined ? 0 : milliseconds(args.holdMs, "holdMs");
  return { holdMs, ...inputTiming(args, holdMs, ordinaryTimeoutMs) };
}

/** Node timers accept signed 32-bit intervals; chain monotonic chunks without wrapping. */
export function executionDeadline(
  milliseconds: number,
  expired: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = milliseconds;
  let previous = performance.now();
  const arm = () => {
    const now = performance.now();
    remaining -= now - previous;
    previous = now;
    if (remaining <= 0) expired();
    else timer = setTimeout(arm, Math.min(remaining, 2_147_483_647));
  };
  if (milliseconds !== 0) arm();
  return () => clearTimeout(timer);
}
