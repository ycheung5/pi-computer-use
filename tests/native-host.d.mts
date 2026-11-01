import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export function computerUseHost(): {
  tools: Map<string, ToolDefinition>;
  registrations: ToolDefinition[];
  shutdown: Array<() => Promise<void>>;
  emit(event: string, value: unknown): Promise<void>;
  api: Pick<ExtensionAPI, "registerTool" | "on">;
};
