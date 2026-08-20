import type { McpServer } from "@modelcontextprotocol/server";

import { WIDGET_BUNDLES, WIDGET_STYLES } from "./bundles.generated.js";

export const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

interface WidgetDefinition {
  bundle: string;

  uri: string;
  title: string;
  description: string;
}

export const WIDGETS = {
  serp: {
    bundle: "serp",
    uri: "ui://mrscraper/serp/v1.html",
    title: "Google results",
    description: "Google search results with titles, links, and snippets.",
  },
  records: {
    bundle: "records",
    uri: "ui://mrscraper/records/v1.html",
    title: "Extracted data",
    description: "Extracted records and stored scrape results as a table.",
  },
  status: {
    bundle: "status",
    uri: "ui://mrscraper/status/v1.html",
    title: "Account status",
    description: "MrScraper subscription plan and token usage.",
  },
} satisfies Record<string, WidgetDefinition>;

export type WidgetName = keyof typeof WIDGETS;

export function widgetHtml(name: WidgetName): string {
  const bundle = WIDGET_BUNDLES[WIDGETS[name].bundle] ?? "";
  return (
    `<style>${WIDGET_STYLES}</style>` +
    `<div id="mrscraper-root"></div>` +
    `<script type="module">${bundle.replace(/<\/script/gi, "<\\/script")}</script>`
  );
}

export function widgetMeta(
  name: WidgetName,
  invoking: string,
  invoked: string,
): Record<string, unknown> {
  const { uri } = WIDGETS[name];
  return {
    ui: { resourceUri: uri },
    "openai/outputTemplate": uri,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

export function registerWidgets(server: McpServer): void {
  for (const [name, definition] of Object.entries(WIDGETS)) {
    server.registerResource(
      definition.bundle,
      definition.uri,
      {
        title: definition.title,
        description: definition.description,
        mimeType: WIDGET_MIME_TYPE,
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: WIDGET_MIME_TYPE,
            text: widgetHtml(name as WidgetName),
            _meta: {
              ui: {
                prefersBorder: true,

                csp: { connectDomains: [], resourceDomains: [] },
              },
            },
          },
        ],
      }),
    );
  }
}
