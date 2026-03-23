"""MCP resources for ChatGPT App SDK widgets."""

from fastmcp import FastMCP

from mrscraper_mcp.constants import SCRAPE_JOB_WIDGET_URI


def register_widget_resources(mcp: FastMCP) -> None:
    @mcp.resource(
        SCRAPE_JOB_WIDGET_URI,
        name="MrScraper Job Status Widget",
        mime_type="text/html;profile=mcp-app",
        meta={
            "openai/widgetDescription": (
                "Shows background scraper progress, status, and final result preview."
            ),
            "openai/widgetPrefersBorder": True,
            "openai/widgetCSP": {
                "connect_domains": [],
                "resource_domains": [],
            },
        },
    )
    def scrape_job_widget() -> str:
        return """<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MrScraper Job Status</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      padding: 12px;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      background: transparent;
      color: inherit;
    }
    .card {
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      border-radius: 10px;
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      opacity: 0.92;
    }
    .pill {
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 12px;
      border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
    }
    .bar {
      height: 8px;
      border-radius: 999px;
      background: color-mix(in srgb, currentColor 12%, transparent);
      overflow: hidden;
    }
    .bar > div {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #4f46e5, #10b981);
      transition: width 180ms ease;
    }
    .msg { font-size: 13px; opacity: 0.9; }
    .grid {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 4px 8px;
      font-size: 12px;
      opacity: 0.85;
      word-break: break-word;
    }
    .result {
      margin-top: 6px;
      font-size: 12px;
      border-radius: 8px;
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      padding: 8px;
      max-height: 280px;
      overflow: auto;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    button {
      border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
      border-radius: 8px;
      background: transparent;
      color: inherit;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="head">
      <strong>MrScraper Job</strong>
      <span id="status" class="pill">queued</span>
    </div>
    <div class="bar"><div id="progressBar"></div></div>
    <div id="message" class="msg">Waiting for updates...</div>
    <div class="grid">
      <div>Job ID</div><div id="jobId">-</div>
      <div>Tool</div><div id="toolName">-</div>
      <div>Progress</div><div id="progressText">0%</div>
    </div>
    <div>
      <button id="loadResult" type="button" disabled></button>
    </div>
    <div id="result" class="result" hidden></div>
  </div>

  <script type="module">
    const statusEl = document.getElementById("status");
    const progressBar = document.getElementById("progressBar");
    const progressText = document.getElementById("progressText");
    const jobIdEl = document.getElementById("jobId");
    const toolNameEl = document.getElementById("toolName");
    const messageEl = document.getElementById("message");
    const loadResultBtn = document.getElementById("loadResult");
    const resultEl = document.getElementById("result");

    let last = {};
    let pollTimer = null;
    let pollDelayMs = 1500;
    let loadingFinal = false;
    let finalLoaded = false;

    function safeJsonParse(value) {
      if (typeof value !== "string") return null;
      try { return JSON.parse(value); } catch (_err) { return null; }
    }

    function normalizeToolResult(result) {
      if (!result) return {};
      // Some runtimes return CallToolResult directly.
      if (result.structuredContent && typeof result.structuredContent === "object") {
        return result.structuredContent;
      }
      // Some runtimes wrap in { result: { ... } }.
      if (result.result && typeof result.result === "object") {
        return normalizeToolResult(result.result);
      }
      // If content has JSON text, attempt parse.
      if (Array.isArray(result.content) && result.content.length > 0) {
        const first = result.content[0];
        if (first && typeof first.text === "string") {
          const parsed = safeJsonParse(first.text);
          if (parsed && typeof parsed === "object") return parsed;
        }
      }
      // ChatGPT widget globals usually provide structured object directly.
      if (typeof result === "object") return result;
      return {};
    }

    function extractStateFromGlobals() {
      const output = normalizeToolResult(window.openai?.toolOutput);
      const meta = normalizeToolResult(window.openai?.toolResponseMetadata);
      const metaJob = meta?.job && typeof meta.job === "object" ? meta.job : {};
      return {
        ...metaJob,
        ...output,
      };
    }

    function render(payload) {
      if (!payload || typeof payload !== "object") return;
      last = payload;
      const status = payload.status ?? "queued";
      const progress = Number(payload.progress ?? 0);
      const isDone = Boolean(payload.isDone);

      statusEl.textContent = status;
      progressBar.style.width = `${Math.max(0, Math.min(progress, 100))}%`;
      progressText.textContent = `${Math.round(progress)}%`;
      jobIdEl.textContent = payload.jobId ?? "-";
      toolNameEl.textContent = payload.toolName ?? "-";
      messageEl.textContent = payload.message ?? "Working...";

      loadResultBtn.disabled = !(isDone && payload.jobId);
      if (isDone) {
        stopPolling();
        if (!finalLoaded && !loadingFinal && payload.jobId) {
          loadFinalResult();
        }
      }
    }

    function stopPolling() {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    }

    function scheduleNextPoll() {
      stopPolling();
      if (!last?.jobId || last?.isDone) return;
      pollTimer = setTimeout(pollStatus, pollDelayMs);
    }

    async function pollStatus() {
      if (!window.openai?.callTool || !last?.jobId) return;
      try {
        const raw = await window.openai.callTool("get_scrape_job_status", {
          job_id: last.jobId,
          include_result: false,
        });
        const payload = normalizeToolResult(raw);
        if (payload && typeof payload === "object") {
          render(payload);
        }
        // Progressive backoff to reduce server churn.
        pollDelayMs = Math.min(7000, Math.round(pollDelayMs * 1.35));
      } catch (_err) {
        // Retry with capped backoff on transient failures.
        pollDelayMs = Math.min(10000, Math.round(pollDelayMs * 1.5));
      } finally {
        scheduleNextPoll();
      }
    }

    async function loadFinalResult() {
      if (!window.openai?.callTool || !last?.jobId) return;
      loadingFinal = true;
      loadResultBtn.disabled = true;
      try {
        const raw = await window.openai.callTool("get_scrape_job_result", {
          job_id: last.jobId,
        });
        const payload = normalizeToolResult(raw);
        if (payload && typeof payload === "object") {
          const text = JSON.stringify(payload, null, 2);
          resultEl.hidden = false;
          resultEl.textContent = text.length > 24000 ? `${text.slice(0, 24000)}\\n...truncated...` : text;
          finalLoaded = true;
        }
      } catch (err) {
        resultEl.hidden = false;
        resultEl.textContent = `Failed to load result: ${String(err)}`;
      } finally {
        loadingFinal = false;
        loadResultBtn.disabled = false;
      }
    }

    loadResultBtn.addEventListener("click", loadFinalResult);

    function syncFromRuntimeGlobals() {
      const merged = extractStateFromGlobals();
      if (merged && typeof merged === "object") {
        render(merged);
      }
      if (merged?.jobId && !merged?.isDone) {
        pollDelayMs = 1500;
        scheduleNextPoll();
      }
    }

    // Initial hydration.
    syncFromRuntimeGlobals();

    // Best practice: react to host global updates from ChatGPT runtime.
    window.addEventListener("openai:set_globals", (_event) => {
      syncFromRuntimeGlobals();
    }, { passive: true });

    // Safety fallback in case runtime event is missed.
    setTimeout(() => {
      if (!last?.jobId) {
        syncFromRuntimeGlobals();
      }
      if (!last?.jobId) {
        messageEl.textContent = "Waiting for job payload from host...";
      }
    }, 300);

    // Stop timers when host closes widget.
    window.addEventListener("beforeunload", () => {
      stopPolling();
    });
  </script>
</body>
</html>"""
