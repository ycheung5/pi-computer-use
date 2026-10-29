// Shared reference-compatible tool schemas; browser execution stays in browser.ts.
const target = {
  windowTitle: { type: "string" },
  processId: { type: "integer", minimum: 1 },
  nativeWindowHandle: { type: "integer", minimum: 1 },
  activate: { type: "boolean", default: false },
};
const view = {
  viewMode: {
    type: "string",
    enum: ["control", "content", "raw"],
    default: "control",
  },
  includeOffscreen: { type: "boolean", default: false },
};
const tab = { browserTab: { type: "string", minLength: 1 } };
const element = { elementId: { type: "string", minLength: 1 } };
const point = { x: { type: "integer" }, y: { type: "integer" } };
const button = {
  type: "string",
  enum: ["left", "right", "middle"],
  default: "left",
};
const dispatch = {
  type: "string",
  enum: ["auto", "background", "foreground"],
  default: "auto",
};
type Rule = {
  type: string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  minItems?: number;
  items?: Rule;
};
const definitions: Record<
  string,
  { properties: Record<string, Rule>; required?: string[] }
> = {
  click: {
    properties: { ...target, ...view, ...element, ...point, button, dispatch },
  },
  double_click: {
    properties: { ...target, ...view, ...element, ...point, button, dispatch },
  },
  move: { properties: { ...target, ...view, ...element, ...point } },
  scroll: {
    properties: {
      ...target,
      ...view,
      ...tab,
      ...element,
      ...point,
      deltaY: { type: "integer", default: 480 },
      deltaX: { type: "integer", default: 0 },
    },
  },
  type_text: {
    required: ["text"],
    properties: {
      ...target,
      ...tab,
      text: { type: "string" },
      method: {
        type: "string",
        enum: ["auto", "clipboard", "sendinput", "background"],
        default: "auto",
      },
      focusMode: {
        type: "string",
        enum: ["preserve", "main"],
        default: "preserve",
      },
      restoreClipboard: { type: "boolean", default: true },
    },
  },
  keypress: {
    required: ["keys"],
    properties: {
      ...target,
      ...tab,
      keys: {
        type: "array",
        minItems: 1,
        items: { type: "string", minLength: 1 },
      },
      dispatch: {
        type: "string",
        enum: ["foreground", "background"],
        default: "foreground",
      },
    },
  },
  focus: {
    required: ["elementId"],
    properties: { ...target, ...view, ...element },
  },
  invoke: {
    required: ["elementId"],
    properties: {
      ...target,
      ...view,
      ...element,
      action: {
        type: "string",
        enum: ["default", "expand", "collapse", "scroll_into_view"],
        default: "default",
      },
      fallbackClick: { type: "boolean", default: true },
    },
  },
  set_value: {
    required: ["elementId", "value"],
    properties: {
      ...target,
      ...view,
      ...element,
      value: { type: "string" },
      fallbackType: { type: "boolean", default: true },
      restoreClipboard: { type: "boolean", default: true },
    },
  },
  activate_window: { properties: { ...target, ...tab } },
  close_window: { properties: { ...target, ...tab } },
  wait_for: {
    properties: {
      ...target,
      ...tab,
      ...view,
      condition: {
        type: "string",
        enum: ["window", "element", "text"],
        default: "window",
      },
      query: { type: "string" },
      controlType: { type: "string" },
      scope: {
        type: "string",
        enum: ["active_window", "desktop"],
        default: "active_window",
      },
      treeTimeoutMs: {
        type: "integer",
        minimum: 100,
        maximum: 30000,
        default: 1000,
      },
      maxDepth: { type: "integer", minimum: 0, maximum: 12, default: 8 },
      maxNodes: { type: "integer", minimum: 1, maximum: 5000, default: 1200 },
      appear: { type: "boolean", default: true },
      timeoutMs: {
        type: "integer",
        minimum: 100,
        maximum: 60000,
        default: 5000,
      },
      intervalMs: { type: "integer", minimum: 50, maximum: 5000, default: 250 },
    },
  },
};
export const browserActionTools = Object.entries(definitions).map(
  ([action, definition]) => ({
    action,
    parameters: { type: "object", additionalProperties: false, ...definition },
  }),
);

export function normalizeBrowserAction(
  action: string,
  args: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const definition = definitions[action];
  if (!definition) return undefined;
  const properties: Record<string, Rule> = { ...definition.properties, ...tab };
  for (const key of Object.keys(args))
    if (!Object.hasOwn(properties, key))
      throw new Error(`INVALID_ARGUMENTS: unknown option ${key}`);
  const normalized: Record<string, unknown> = {};
  const check = (name: string, value: unknown, rule: Rule): void => {
    if (rule.type === "array") {
      if (
        !Array.isArray(value) ||
        value.length < (rule.minItems ?? 0) ||
        value.length > 10000
      )
        throw new Error(
          `INVALID_ARGUMENTS: ${name} must be an array with supported length`,
        );
      if (rule.items) for (const child of value) check(name, child, rule.items);
    } else if (
      rule.type === "integer"
        ? !Number.isSafeInteger(value)
        : typeof value !== rule.type
    )
      throw new Error(`INVALID_ARGUMENTS: ${name} must be ${rule.type}`);
    if (
      (typeof value === "number" &&
        ((rule.minimum !== undefined && value < rule.minimum) ||
          (rule.maximum !== undefined && value > rule.maximum))) ||
      (typeof value === "string" &&
        ((rule.enum && !rule.enum.includes(value)) ||
          (rule.minLength !== undefined && value.length < rule.minLength)))
    )
      throw new Error(`INVALID_ARGUMENTS: ${name} has an unsupported value`);
  };
  for (const [key, rule] of Object.entries(properties)) {
    const value = Object.hasOwn(args, key) ? args[key] : rule.default;
    if (value === undefined) {
      if (definition.required?.includes(key))
        throw new Error(`INVALID_ARGUMENTS: ${key} is required`);
      continue;
    }
    check(key, value, rule);
    normalized[key] = value;
  }
  if (action === "keypress") {
    const keys = normalized.keys as string[];
    if (keys.some((key) => /^(win|windows|meta|cmd|command)$/i.test(key)))
      throw new Error("INVALID_ARGUMENTS: Windows key is blocked");
    if (
      keys.filter((key) => !/^(ctrl|control|alt|option|shift)$/i.test(key))
        .length !== 1
    )
      throw new Error(
        "INVALID_ARGUMENTS: keypress needs exactly one non-modifier key",
      );
  }
  if (action === "invoke" && normalized.action !== "default")
    throw new Error(
      "INVALID_ARGUMENTS: non-default invoke actions apply only to UI Automation elements",
    );
  if (
    action === "wait_for" &&
    (normalized.condition === "window" ||
      typeof normalized.query !== "string" ||
      !normalized.query.trim())
  )
    throw new Error(
      "INVALID_ARGUMENTS: browser wait_for requires element/text condition and query",
    );
  return normalized;
}
