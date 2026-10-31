import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const inBox = (outer, inner) =>
  outer &&
  inner &&
  ["x", "y", "width", "height"].every(
    (k) => Number.isFinite(outer[k]) && Number.isFinite(inner[k]),
  ) &&
  inner.width > 0 &&
  inner.height > 0 &&
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;
export function traceWithoutImages(value) {
  if (Array.isArray(value)) return value.map(traceWithoutImages);
  if (!value || typeof value !== "object") return value;
  if (value.type === "image") return { type: "image", omittedFromTrace: true };
  if (value.type === "text" && typeof value.text === "string") {
    try {
      return {
        ...value,
        text: JSON.stringify(traceWithoutImages(JSON.parse(value.text))),
      };
    } catch {
      /* Ordinary text is not an encoded tool result. */
    }
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !["base64", "data"].includes(k))
      .map(([k, v]) => [k, traceWithoutImages(v)]),
  );
}
function safeImage(image, proof) {
  return (
    image &&
    image.windowCaptureFailed === false &&
    image.occludedPossible === false &&
    ["printwindow", "wgc", "screen-region"].includes(image.method) &&
    inBox(proof.windowBounds, image.bounds) &&
    inBox(image.bounds, proof.clientBounds) &&
    image.origin?.x === image.bounds.x &&
    image.origin?.y === image.bounds.y &&
    image.width > 0 &&
    image.height > 0 &&
    image.imageScale > 0 &&
    image.imageScaleY > 0
  );
}
function safeOcr(d, proof) {
  return (
    d.source === "window" &&
    d.captureConclusive === true &&
    d.occludedPossible === false &&
    ["printwindow", "wgc", "screen-region"].includes(d.captureMethod) &&
    inBox(proof.windowBounds, d.imageBounds) &&
    inBox(d.imageBounds, proof.clientBounds) &&
    d.imageScale > 0 &&
    d.imageScaleY > 0
  );
}
export function createVisualGuard(owned, verify) {
  let halted = false,
    activated = false;
  const observed = new Set(),
    refs = new Set();
  const denial = (reason) => ({
    block: true,
    reason: "OWNED_VISUAL_SCOPE: " + reason,
  });
  const redacted = () => {
    halted = true;
    const details = {
      ok: false,
      error:
        "OWNED_VISUAL_CAPTURE_UNAVAILABLE: unsafe or unproven owned capture/result; no image or derived text forwarded",
      conclusive: false,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(details) }],
      details,
      isError: true,
    };
  };
  const proofNow = () => {
    const p = verify();
    if (
      !p?.ok ||
      p.nativeWindowHandle !== owned.nativeWindowHandle ||
      p.processId !== owned.processId
    )
      throw Error("owned fixture proof unavailable");
    return p;
  };
  return {
    before(e) {
      try {
        const n = e.toolName?.replace(/^windows_computer_use_/, ""),
          a = e.input ?? {};
        if (halted)
          return denial("stopped or uncertain prior observation/effect");
        if (
          ![
            "snapshot",
            "accessibility_tree",
            "find",
            "element_info",
            "ocr",
            "screenshot",
            "invoke",
          ].includes(n)
        )
          return denial("unsupported tool");
        if (
          a.scope === "desktop" ||
          a.browserTab !== undefined ||
          (a.activate !== undefined && a.activate !== false) ||
          (a.processId !== undefined && a.processId !== owned.processId) ||
          (a.nativeWindowHandle !== undefined &&
            a.nativeWindowHandle !== owned.nativeWindowHandle) ||
          (a.windowTitle !== undefined &&
            !String(a.windowTitle).includes(owned.title))
        )
          return denial("outside the owned fixture");
        if (a.windowRef !== undefined && !refs.has(a.windowRef))
          return denial("windowRef was not supplied by an owned public result");
        if (
          a.nativeWindowHandle === undefined &&
          !refs.has(a.windowRef) &&
          !(["element_info", "invoke"].includes(n) && observed.has(a.elementId))
        )
          return denial(
            "explicit owned target or publicly observed reference required",
          );
        const p = proofNow();
        if (
          n === "snapshot" &&
          a.includeScreenshot !== false &&
          a.captureWindow !== true
        )
          return denial("snapshot images must request captureWindow:true");
        if (
          n === "element_info" &&
          a.elementId !== undefined &&
          !observed.has(a.elementId)
        )
          return denial(
            "element inspection requires a publicly observed owned button ID",
          );
        if (
          n === "element_info" &&
          (a.x !== undefined || a.y !== undefined) &&
          (!Number.isInteger(a.x) ||
            !Number.isInteger(a.y) ||
            !inBox(p.clientBounds, { x: a.x, y: a.y, width: 1, height: 1 }))
        )
          return denial("point inspection must stay inside owned client");
        if (
          n === "invoke" &&
          (!observed.has(a.elementId) ||
            a.fallbackClick !== false ||
            (a.action !== undefined && a.action !== "default") ||
            activated)
        )
          return denial(
            "one observed button semantic invocation; fallbackClick:false required",
          );
      } catch {
        return denial("independent owned fixture verification failed");
      }
    },
    after(e) {
      try {
        const n = e.toolName?.replace(/^windows_computer_use_/, ""),
          d = e.details ?? {},
          a = e.input ?? {},
          p = proofNow();
        if (
          (e.content ?? []).some(
            (c) =>
              c.type === "text" &&
              String(c.text).startsWith("OWNED_VISUAL_SCOPE:"),
          )
        )
          return;
        if (
          d.ok === true &&
          ["snapshot", "accessibility_tree", "find"].includes(n) &&
          (d.nativeWindowHandle !== owned.nativeWindowHandle ||
            d.processId !== owned.processId)
        )
          return redacted();
        if (
          (d.inputTargetHandle !== undefined &&
            d.inputTargetHandle !== owned.nativeWindowHandle) ||
          (d.inputTargetProcessId !== undefined &&
            d.inputTargetProcessId !== owned.processId)
        )
          return redacted();
        if (
          (d.nativeWindowHandle !== undefined &&
            d.nativeWindowHandle !== owned.nativeWindowHandle) ||
          (d.processId !== undefined && d.processId !== owned.processId)
        )
          return redacted();
        if (
          /COMPUTER_USE_STOPPED|COMPUTER_USE_CANCELLED|CLEANUP_UNCONFIRMED|DISPATCH_UNCONFIRMED/.test(
            String(d.error ?? ""),
          ) ||
          d.cleanupConfirmed === false
        ) {
          halted = true;
          return redacted();
        }
        const hasImage =
          (e.content ?? []).some((c) => c.type === "image") ||
          d.screenshot !== undefined;
        if (
          (hasImage || n === "ocr") &&
          [a.scope, d.scope, d.source].includes("desktop")
        )
          return redacted();
        if (
          hasImage &&
          (!safeImage(d.screenshot, p) ||
            (n === "snapshot" && a.captureWindow !== true))
        )
          return redacted();
        if (n === "ocr" && (d.ok !== true || !safeOcr(d, p))) return redacted();
        if (
          (d.ocr !== undefined || d.ocrCandidates !== undefined) &&
          (d.ocr?.ok !== true || !safeOcr(d.ocr, p))
        )
          return redacted();
        if (d.ok === true && typeof d.windowRef === "string")
          refs.add(d.windowRef);
        const visit = (node) => {
          if (!node || typeof node !== "object") return;
          if (
            node.controlType === "Button" &&
            node.name === "" &&
            inBox(p.clientBounds, node.boundingBox) &&
            typeof node.id === "string"
          )
            observed.add(node.id);
          for (const c of node.children ?? []) visit(c);
        };
        if (
          d.ok === true &&
          ["snapshot", "accessibility_tree", "find", "element_info"].includes(n)
        ) {
          visit(d.tree);
          visit(d.element);
          for (const m of d.matches ?? []) visit(m);
        }
        if (n === "invoke") {
          if (d.ok === true) activated = true;
          else if (
            !/^(?:WINDOWS_ERROR: )?(?:STALE_ELEMENT|ELEMENT_WRONG_OWNER|ELEMENT_DISABLED|INVALID_ARGUMENTS|UNSUPPORTED_PATTERN)(?::|$)/.test(
              String(d.error ?? ""),
            )
          )
            halted = true;
        }
        return {
          content: e.content,
          details: traceWithoutImages(d),
          isError: e.isError,
        };
      } catch {
        return redacted();
      }
    },
  };
}

// Central SDK before-hook boundary: authorization and auditing must never throw through Pi.
export function visualBeforeHook(guard, readOwners, record) {
  return (event) => {
    let decision;
    const denial = (reason) => ({
      block: true,
      reason: "OWNED_VISUAL_SCOPE: " + reason,
    });
    try {
      const owners = readOwners();
      if (
        owners.length !== 2 ||
        owners.some(
          (owner) =>
            owner?.phase !== "running" ||
            !Number.isFinite(owner.expiresAt) ||
            owner.expiresAt <= Date.now(),
        )
      )
        decision = denial("owner retained, expired, or not proven running");
      else decision = guard.before(event);
    } catch {
      decision = denial("owner journal or authorization unavailable");
    }
    try {
      record({
        type: "tool_call",
        tool: event.toolName,
        input: event.input,
        blocked: decision?.block === true,
        reason: decision?.reason ?? null,
      });
    } catch {
      decision ??= denial("scope audit unavailable");
    }
    return decision;
  };
}

export default async function (pi) {
  const config = JSON.parse(process.env.PI_CU_VISUAL_SPEC ?? "null");
  const { dir, owned, clientCode } = config;
  const verify = () => {
    const o = JSON.parse(
      execFileSync(
        owned.windowsNode,
        ["-e", clientCode, owned.pipeName, "oracle"],
        {
          encoding: "utf8",
          timeout: 15000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ),
    );
    if (
      o.ok !== true ||
      o.identity?.pid !== owned.identity.pid ||
      o.identity?.creation !== owned.identity.creation ||
      o.identity?.executable !== owned.identity.executable
    )
      throw Error("pinned process unavailable");
    return { ok: true, ...o.target };
  };
  const guard = createVisualGuard(owned, verify);
  let sequence = 0;
  const record = (e) =>
    appendFileSync(
      dir + "/guard.jsonl",
      JSON.stringify(traceWithoutImages({ sequence: ++sequence, ...e })) + "\n",
      { mode: 0o600 },
    );
  pi.on(
    "tool_call",
    visualBeforeHook(
      guard,
      () =>
        ["owner.json", "fixture-owner.json"].map((name) =>
          JSON.parse(readFileSync(dir + "/" + name, "utf8")),
        ),
      record,
    ),
  );
  pi.on("tool_result", (e) => guard.after(e));
  // SDK passes the guard replacement to later handlers. Auditing never substitutes the original event.
  pi.on("tool_result", (e) => {
    try {
      record({
        type: "tool_result",
        tool: e.toolName,
        details: e.details,
        isError: e.isError === true,
        content: e.content,
      });
    } catch {
      /* Preserve guarded content even if local audit fails. */
    }
  });
  const { default: computerUse } = await import("../dist/extension.js");
  computerUse(pi);
}
