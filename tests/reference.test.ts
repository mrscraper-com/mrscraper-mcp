import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as tools from "../src/tools.js";

const reference = JSON.parse(
  readFileSync(
    new URL("../docs/service-reference.json", import.meta.url),
    "utf8",
  ),
) as {
  parameters: Record<string, { name: string; description: string }>;
  services: Array<{ name: string; description: string; parameters: string[] }>;
};
const schemas = {
  status: tools.statusInputSchema,
  scrapeHtml: tools.scrapeHtmlInputSchema,
  scrapeMarkdown: tools.scrapeMarkdownInputSchema,
  getScreenshot: tools.getScreenshotInputSchema,
  scrapeBrand: tools.scrapeBrandInputSchema,
  scrapeJson: tools.scrapeJsonInputSchema,
  webSearch: tools.webSearchInputSchema,
};
const camel = (value: string) =>
  value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
describe("standard public descriptions", () => {
  for (const service of reference.services) {
    it(service.name, () => {
      const name = camel(service.name) as keyof typeof schemas;
      expect(tools.TOOL_DESCRIPTIONS[name]).toBe(service.description);
      const fields = z.toJSONSchema(schemas[name]).properties!;
      for (const key of service.parameters) {
        const parameter = reference.parameters[key]!;
        const field = fields[parameter.name];
        expect(
          field && typeof field === "object" ? field.description : undefined,
        ).toBe(parameter.description);
      }
    });
  }
});
