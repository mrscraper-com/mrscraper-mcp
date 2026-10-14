#!/usr/bin/env node

import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import "dotenv/config";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";

import { TOOL_NAMES, VERSION, type ToolName } from "../src/config.js";

const projectDir = fileURLToPath(new URL("../", import.meta.url));
const serverFile = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

export async function testTool(
  name: ToolName,
  args: Record<string, unknown>,
  target?: string,
): Promise<number> {
  const token = (
    process.env.MRSCRAPER_API_KEY ||
    process.env.MRSCRAPER_API_TOKEN ||
    ""
  ).trim();
  if (!token)
    throw new Error(
      "Set MRSCRAPER_API_KEY or MRSCRAPER_API_TOKEN before testing.",
    );
  if (!target) {
    try {
      await access(serverFile);
    } catch {
      throw new Error("Built server is missing. Run npm run build first.");
    }
  }
  const endpointOverrides = Object.fromEntries(
    [
      "MRSCRAPER_API_BASE_URL",
      "MRSCRAPER_FETCH_BASE_URL",
      "MRSCRAPER_SYNC_BASE_URL",
    ].flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : [])),
  );
  const transport = target
    ? new StreamableHTTPClientTransport(new URL(target), {
        authProvider: { token: async () => token },
      })
    : new StdioClientTransport({
        command: process.execPath,
        args: [serverFile],
        cwd: projectDir,
        env: {
          ...getDefaultEnvironment(),
          ...endpointOverrides,
          MRSCRAPER_API_KEY: token,
          TRANSPORT: "stdio",
        },
        stderr: "inherit",
      });
  const client = new Client({
    name: "mrscraper-manual-test",
    version: VERSION,
  });
  const safeMessage = (value: string) => value.replaceAll(token, "[REDACTED]");
  try {
    console.log(`Testing ${name} via ${target || "local stdio server"}`);
    await client.connect(transport);
    await client.ping();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    console.log(`Tools: ${names.join(", ")}`);
    assert.deepEqual(
      [...names].sort(),
      [...TOOL_NAMES].sort(),
      "Server must expose only scraperAPI, webSearch, and status. Rebuild or restart the server.",
    );
    const upstreamTimeout =
      typeof args.timeout === "number" && args.timeout > 0
        ? args.timeout
        : name === "scraperAPI"
          ? 120
          : 600;
    const result = await client.callTool(
      { name, arguments: args },
      {
        timeout:
          (upstreamTimeout + (name === "scraperAPI" ? 30 : 0) + 15) * 1000,
      },
    );
    console.log(
      safeMessage(
        JSON.stringify(
          {
            structuredContent: result.structuredContent,
            content: result.structuredContent ? undefined : result.content,
            isError: result.isError || false,
          },
          null,
          2,
        ),
      ),
    );
    if (result.isError) return 1;
    const output = result.structuredContent as
      Record<string, unknown> | undefined;
    assert.ok(
      output &&
        typeof output.status_code === "number" &&
        output.status_code >= 200 &&
        output.status_code < 300,
      `${name} must return a successful HTTP status.`,
    );
    assert.ok(
      output.data !== null && output.data !== undefined,
      `${name} must return data.`,
    );
    console.log(`PASS ${name}`);
    return 0;
  } catch (error) {
    throw new Error(
      safeMessage(error instanceof Error ? error.message : String(error)),
    );
  } finally {
    await client.close();
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      args: { type: "string" },
      url: {
        type: "string",
        default: "https://www.scrapethissite.com/pages/simple/",
      },
      query: { type: "string", default: "MrScraper web scraping" },
      target: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(`Usage: npm run test:manual -- <scraperAPI|webSearch|status> [options]

  --url URL       Page for scraperAPI (default: Scrapethissite countries page)
  --query TEXT    Query for webSearch (default: MrScraper web scraping)
  --args JSON     Complete tool arguments; overrides the sample arguments
  --target URL    Test an existing HTTP MCP server instead of local stdio

Examples:
  npm run test:manual -- scraperAPI --url https://example.com
  npm run test:manual -- webSearch --query "web scraping"
  npm run test:manual -- status
  npm run test:manual -- scraperAPI --args '{"url":"https://example.com","markdown":true,"screenshot":true}'

The webSearch sample uses raw=false and format=json. Each invocation calls one tool.
Set MRSCRAPER_API_KEY or MRSCRAPER_API_TOKEN first; .env is loaded automatically.`);
    return 0;
  }
  const name = positionals[0];
  if (positionals.length !== 1 || !TOOL_NAMES.includes(name as ToolName)) {
    console.error(
      "Choose exactly one tool: scraperAPI, webSearch, or status. Use --help for examples.",
    );
    return 2;
  }
  let args: unknown;
  try {
    args =
      values.args !== undefined
        ? JSON.parse(values.args)
        : name === "scraperAPI"
          ? { url: values.url }
          : name === "status"
            ? {}
            : {
                url: values.query,
                raw: false,
                format: "json",
                region: "us",
                language: "en",
                page: 1,
              };
  } catch {
    console.error("--args must be valid JSON.");
    return 2;
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    console.error("--args must decode to a JSON object.");
    return 2;
  }
  return testTool(
    name as ToolName,
    args as Record<string, unknown>,
    values.target,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      const code = (error as NodeJS.ErrnoException)?.code;
      process.exitCode = code?.startsWith("ERR_PARSE_ARGS") ? 2 : 1;
    });
}
