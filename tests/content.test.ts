import { describe, expect, it } from "vitest";

import {
  convertHtml,
  formatFetchResult,
  htmlToDocument,
} from "../src/content.js";

const HTML = `
<html lang="en">
  <head>
    <title>Example Product</title>
    <meta name="description" content="A useful item">
    <script>window.secret = true</script>
  </head>
  <body>
    <h1>Example Product</h1>
    <a href="/buy">Buy now</a>
    <img src="/item.jpg" alt="Item">
  </body>
</html>`;

describe("page content formatting", () => {
  it("removes scripts and resolves links in Markdown", () => {
    const markdown = convertHtml(HTML, "markdown", "https://shop.example/item");
    expect(markdown).toContain("# Example Product");
    expect(markdown).toContain("https://shop.example/buy");
    expect(markdown).not.toContain("window.secret");
  });

  it("returns a clean page document", () => {
    expect(htmlToDocument(HTML, "https://shop.example/item")).toEqual({
      url: "https://shop.example/item",
      title: "Example Product",
      description: "A useful item",
      language: "en",
      text: "Example Product Buy now",
      links: [{ text: "Buy now", url: "https://shop.example/buy" }],
      images: [{ alt: "Item", url: "https://shop.example/item.jpg" }],
    });
  });

  it("preserves response metadata while formatting", () => {
    const result = formatFetchResult(
      {
        status_code: 200,
        data: HTML,
        headers: { "x-request-id": "one" },
        unblocker: { requested: "never" },
      },
      { format: "json", url: "https://shop.example/item" },
    );
    expect(result.format).toBe("json");
    expect(result.url).toBe("https://shop.example/item");
    expect(result.data).toMatchObject({ title: "Example Product" });
    expect(result.headers).toEqual({ "x-request-id": "one" });
  });
});
