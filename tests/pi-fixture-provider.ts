// Local scripted model responses; only health/list calls enter the real Pi pipeline.
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fixtureProvider(pi: ExtensionAPI): void {
  const fixture = fauxProvider({
    provider: "pi-cu-preflight",
    api: "pi-cu-preflight-fixture",
    models: [{ id: "fixture", contextWindow: 200000, maxTokens: 2000 }],
  });
  fixture.setResponses([
    fauxAssistantMessage(fauxToolCall("windows_computer_use_health", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("windows_computer_use_list_windows", { maxWindows: 3 }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Offline Pi host validation complete."),
  ]);
  pi.registerProvider(fixture.provider);
}
