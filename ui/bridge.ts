declare global {
  interface Window {
    openai?: {
      toolOutput?: unknown;
      toolInput?: unknown;
    };
  }
}

type Listener = (output: Record<string, unknown>) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function onToolOutput(listener: Listener): void {
  const immediate = window.openai?.toolOutput;
  if (isRecord(immediate)) listener(immediate);

  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data;
    if (!isRecord(data)) return;

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
}
