// Scripted provider drives the real Pi host; it does not exercise a real model.
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function provider(pi: ExtensionAPI): void {
  const target = JSON.parse(process.env.PI_CU_HOST_STOP_TARGET ?? "{}");
  if (
    !Number.isSafeInteger(target.nativeWindowHandle) ||
    !Number.isSafeInteger(target.processId)
  )
    throw new Error("PI_CU_HOST_STOP_TARGET_INVALID");
  const faux = fauxProvider({
    provider: "pi-cu-stop-host",
    api: "pi-cu-stop-host-fixture",
    models: [{ id: "fixture", contextWindow: 200000, maxTokens: 2000 }],
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("windows_computer_use_health", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("windows_computer_use_type_text", {
        ...target,
        text: "x".repeat(2000),
        method: "sendinput",
        activate: true,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Scripted host fixture finished."),
  ]);
  pi.registerProvider(faux.provider);
}
