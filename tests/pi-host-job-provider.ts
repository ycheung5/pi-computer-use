// No physical input: scripted Pi tools keep the worker alive briefly for job observation.
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function provider(pi: ExtensionAPI): void {
  const fake = fauxProvider({
    provider: "pi-cu-job",
    api: "pi-cu-job-fixture",
    models: [{ id: "fixture", contextWindow: 200000, maxTokens: 2000 }],
  });
  fake.setResponses([
    fauxAssistantMessage(fauxToolCall("windows_computer_use_health", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("windows_computer_use_list_windows", { maxWindows: 1 }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("windows_computer_use_wait", { milliseconds: 4000 }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Passive job preflight complete."),
  ]);
  pi.registerProvider(fake.provider);
}
