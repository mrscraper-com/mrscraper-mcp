import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { WIDGETS, widgetHtml, type WidgetName } from "../src/widgets/index.js";

const SAMPLES: Record<WidgetName, unknown> = {
  webSearch: {
    status_code: 200,
    data: {
      success: true,
      message: "Successfully scraped",
      data: {
        navigation: [
          { name: "Images", link: "https://www.google.com/search?tbm=isch" },
          { name: "News", link: "https://www.google.com/search?tbm=nws" },
        ],
        organic: [
          {
            title: "Web Scraping API | MrScraper",
            link: "https://mrscraper.com/",
            description:
              "Extract structured data from any website with AI, without writing selectors.",
          },
          {
            title: "MrScraper documentation",
            link: "https://docs.mrscraper.com/",
            description: "Guides, API reference, and the MCP server setup.",
          },
          {
            title: "MrScraper pricing",
            link: "https://mrscraper.com/pricing",
            description: "Plans, token limits, and enterprise options.",
          },
        ],
      },
      tokenUsage: 1,
    },
  },
  status: {
    status_code: 200,
    data: {
      account: {
        subscription_status: "active",
        enterprise: false,
        token_usage: 61_240,
        token_limit: 100_000,
        token_remaining: 38_760,
        usage_percent: 61.24,
        ends_at: "2026-09-14",
        user: {
          name: "Test Account",
          email: "you@example.test",
          verified: true,
        },
      },
    },
  },
};

function frame(name: WidgetName): string {
  const seeded =
    `<script>window.openai={toolOutput:${JSON.stringify(SAMPLES[name])}};</script>` +
    widgetHtml(name);
  return (
    `<section>` +
    `<h2>${WIDGETS[name].title} <code>${WIDGETS[name].uri}</code></h2>` +
    `<iframe sandbox="allow-scripts" srcdoc="${seeded.replace(/"/g, "&quot;")}"></iframe>` +
    `</section>`
  );
}

const page = `<!doctype html>
<meta charset="utf-8">
<title>MrScraper MCP widget preview</title>
<style>
  body { margin: 0; padding: 24px; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
         background: #f6f7f9; color: #16181d; }
  @media (prefers-color-scheme: dark) { body { background: #14161a; color: #e8eaee; } }
  h1 { font-size: 18px; }
  section { margin-bottom: 28px; }
  h2 { font-size: 13px; font-weight: 600; margin: 0 0 8px; }
  code { font-weight: 400; opacity: 0.6; }
  iframe { width: 100%; max-width: 720px; height: 320px; border: 1px solid #d7dae0;
           border-radius: 10px; background: transparent; }
  @media (prefers-color-scheme: dark) { iframe { border-color: #2c3038; } }
</style>
<h1>MrScraper MCP widgets</h1>
<p>Sample tool output, rendered exactly as a host would mount it.</p>
${(Object.keys(WIDGETS) as WidgetName[]).map(frame).join("\n")}
`;

const out = fileURLToPath(new URL("../widget-preview.html", import.meta.url));
await writeFile(out, page, "utf8");
console.log(`Wrote ${out}`);
