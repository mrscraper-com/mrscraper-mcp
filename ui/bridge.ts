declare global {
  interface Window {
    openai?: {
      toolOutput?: unknown;
      toolInput?: unknown;
    };
  }
}

type Listener = (output: Record<string, unknown>) => void;

const UI_PROTOCOL_VERSION = "2026-01-26";
const UI_INITIALIZE_ID = "mrscraper-ui-initialize";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendToHost(message: Record<string, unknown>): void {
  window.parent.postMessage(message, "*");
}

export function onToolOutput(listener: Listener): void {
  const immediate = window.openai?.toolOutput;
  if (isRecord(immediate)) listener(immediate);

  let initialized = false;
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!isRecord(data)) return;

    if (
      data.jsonrpc === "2.0" &&
      data.id === UI_INITIALIZE_ID &&
      "result" in data &&
      !initialized
    ) {
      initialized = true;
      sendToHost({
        jsonrpc: "2.0",
        method: "ui/notifications/initialized",
        params: {},
      });
      return;
    }

    if (
      data.method === "ui/notifications/tool-result" &&
      isRecord(data.params)
    ) {
      const result = isRecord(data.params.structuredContent)
        ? data.params.structuredContent
        : data.params;
      listener(result);
      return;
    }

    if (isRecord(data.toolOutput)) listener(data.toolOutput);
  });

  if (!isRecord(immediate)) {
    let attempts = 0;
    const poll = window.setInterval(() => {
      const output = window.openai?.toolOutput;
      if (isRecord(output)) {
        window.clearInterval(poll);
        listener(output);
        return;
      }
      if ((attempts += 1) > 40) window.clearInterval(poll);
    }, 50);
  }

  if (window.parent !== window) {
    sendToHost({
      jsonrpc: "2.0",
      id: UI_INITIALIZE_ID,
      method: "ui/initialize",
      params: {
        appInfo: { name: "MrScraper Widget", version: "1.0.0" },
        appCapabilities: {},
        protocolVersion: UI_PROTOCOL_VERSION,
      },
    });
  }
}
