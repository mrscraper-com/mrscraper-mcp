import { NodeHtmlMarkdown } from "node-html-markdown";
import { parse } from "node-html-parser";
import type { JSONValue } from "@modelcontextprotocol/server";

import type { ApiResponse } from "./http.js";

export const FETCH_FORMATS = ["markdown", "html", "json"] as const;
export type FetchFormat = (typeof FETCH_FORMATS)[number];

export interface PageDocument {
  url: string;
  title: string | null;
  description: string | null;
  language: string | null;
  text: string;
  links: Array<{ text: string; url: string }>;
  images: Array<{ alt: string; url: string }>;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function resolveHttpUrl(
  value: string | undefined,
  baseUrl: string,
): string | null {
  if (!value || /^(?:data|javascript|mailto|tel):/i.test(value)) return null;
  try {
    const resolved = new URL(value, baseUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

function removeNonContentElements(root: ReturnType<typeof parse>): void {
  for (const element of root.querySelectorAll(
    "script, style, noscript, template, svg",
  )) {
    element.remove();
  }
}

export function htmlToDocument(html: string, url: string): PageDocument {
  const root = parse(html);
  removeNonContentElements(root);

  const title = cleanText(root.querySelector("title")?.textContent || "");
  const description =
    root.querySelector('meta[name="description"]')?.getAttribute("content") ||
    root
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content") ||
    "";
  const language = root.querySelector("html")?.getAttribute("lang") || null;

  const links: PageDocument["links"] = [];
  const seenLinks = new Set<string>();
  for (const anchor of root.querySelectorAll("a")) {
    const resolved = resolveHttpUrl(anchor.getAttribute("href"), url);
    if (!resolved || seenLinks.has(resolved)) continue;
    seenLinks.add(resolved);
    links.push({ text: cleanText(anchor.textContent || ""), url: resolved });
  }

  const images: PageDocument["images"] = [];
  const seenImages = new Set<string>();
  for (const image of root.querySelectorAll("img")) {
    const resolved = resolveHttpUrl(
      image.getAttribute("src") || image.getAttribute("data-src"),
      url,
    );
    if (!resolved || seenImages.has(resolved)) continue;
    seenImages.add(resolved);
    images.push({
      alt: cleanText(image.getAttribute("alt") || ""),
      url: resolved,
    });
  }

  return {
    url,
    title: title || null,
    description: cleanText(description) || null,
    language,
    text: cleanText(
      root.querySelector("body")?.structuredText || root.structuredText,
    ),
    links,
    images,
  };
}

export function convertHtml(
  html: string,
  format: FetchFormat,
  url: string,
): string | PageDocument {
  if (format === "html") return html;
  if (format === "json") return htmlToDocument(html, url);

  const root = parse(html);
  for (const anchor of root.querySelectorAll("a")) {
    const resolved = resolveHttpUrl(anchor.getAttribute("href"), url);
    if (resolved) anchor.setAttribute("href", resolved);
  }
  for (const image of root.querySelectorAll("img")) {
    const resolved = resolveHttpUrl(
      image.getAttribute("src") || image.getAttribute("data-src"),
      url,
    );
    if (resolved) image.setAttribute("src", resolved);
  }
  return NodeHtmlMarkdown.translate(root.toString(), {
    keepDataImages: false,
    useInlineLinks: true,
  }).trim();
}

export function formatFetchResult(
  result: ApiResponse,
  options: { format: FetchFormat; url: string },
): ApiResponse & { format: FetchFormat; url: string } {
  const formatted = { ...result, ...options };
  if (!result.error && typeof result.data === "string") {
    formatted.data = convertHtml(
      result.data,
      options.format,
      options.url,
    ) as JSONValue;
  }
  return formatted;
}
