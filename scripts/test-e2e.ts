#!/usr/bin/env node

import assert from "node:assert/strict";
import { parseArgs } from "node:util";

import "dotenv/config";

import { Client, type CallToolResult } from "@modelcontextprotocol/client";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";

const EXPECTED_TOOLS = [
  "fetch",
  "scrape",
  "serp",
  "status",
  "rerun",
  "results",
  "result",
] as const;
const REQUEST_TIMEOUT_MS = 180_000;

type JsonObject = Record<string, unknown>;

interface ToolCall {
  output: JsonObject;
  elapsedMs: number;
}

function asObject(value: unknown, label: string): JsonObject {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value as JsonObject;
}

function nestedData(output: JsonObject, label: string): JsonObject {
  const envelope = asObject(output.data, `${label}.data`);
  return asObject(envelope.data, `${label}.data.data`);
}

function responseRows(output: JsonObject): JsonObject[] {
  const envelope = asObject(output.data, "results.data");
  assert.ok(Array.isArray(envelope.data), "results.data.data must be an array");
  return envelope.data.map((row, index) =>
    asObject(row, `results.data.data[${index}]`),
  );
}

function assertApiSuccess(name: string, output: JsonObject): void {
  const status = output.status_code;
  assert.ok(typeof status === "number", `${name} must return status_code`);
  assert.ok(
    status >= 200 && status < 300,
    `${name} returned HTTP ${String(status)}`,
  );
}

function sanitizeMessage(value: unknown, token: string): string {
  const message =
    value instanceof Error ? value.stack || value.message : String(value);
  return token ? message.replaceAll(token, "[REDACTED]") : message;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "server-command": { type: "string", default: process.execPath },
      "server-args": { type: "string", default: '["dist/bin.js"]' },
      url: {
        type: "string",
        default: "https://www.scrapethissite.com/pages/simple/",
      },
      "serp-query": { type: "string", default: "MrScraper web scraping" },
    },
  });

  const token = (
    process.env.MRSCRAPER_API_KEY ||
    process.env.MRSCRAPER_API_TOKEN ||
    ""
  ).trim();
  assert.ok(token, "Set MRSCRAPER_API_KEY or MRSCRAPER_API_TOKEN");

  let serverArgs: unknown;
  try {
    serverArgs = JSON.parse(values["server-args"]);
  } catch (error) {
    throw new Error(`--server-args must be a JSON array: ${String(error)}`);
  }
  assert.ok(
    Array.isArray(serverArgs) &&
      serverArgs.every((item) => typeof item === "string"),
    "--server-args must be a JSON array of strings",
  );

  const inheritedEndpointNames = [
    "MRSCRAPER_API_BASE_URL",
    "MRSCRAPER_FETCH_BASE_URL",
    "MRSCRAPER_SYNC_BASE_URL",
  ] as const;
  const endpointOverrides = Object.fromEntries(
    inheritedEndpointNames.flatMap((name) =>
      process.env[name] ? [[name, process.env[name]]] : [],
    ),
  ) as Record<string, string>;
  const transport = new StdioClientTransport({
    command: values["server-command"],
    args: serverArgs,
    cwd: process.cwd(),
    env: {
      ...getDefaultEnvironment(),
      ...endpointOverrides,
      MRSCRAPER_API_KEY: token,
      TRANSPORT: "stdio",
    },
    stderr: "pipe",
  });
  let serverStderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    serverStderr += chunk.toString("utf8");
  });

  const client = new Client({ name: "mrscraper-live-e2e", version: "0.1.0" });
  const completed: string[] = [];

  const call = async (
    name: (typeof EXPECTED_TOOLS)[number],
    args: JsonObject,
  ): Promise<ToolCall> => {
    const started = performance.now();
    const result: CallToolResult = await client.callTool(
      { name, arguments: args },
      { timeout: REQUEST_TIMEOUT_MS },
    );
    assert.equal(
      result.isError,
      undefined,
      `${name} returned an MCP tool error`,
    );
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(token), `${name} leaked the API token`);
    const output = asObject(
      result.structuredContent,
      `${name}.structuredContent`,
    );
    assertApiSuccess(name, output);
    const elapsedMs = Math.round(performance.now() - started);
    completed.push(name);
    console.log(
      `PASS ${name.padEnd(7)} ${String(output.status_code)} (${elapsedMs} ms)`,
    );
    return { output, elapsedMs };
  };

  try {
    await client.connect(transport);
    await client.ping({ timeout: 10_000 });

    const serverVersion = client.getServerVersion();
    assert.equal(serverVersion?.name, "MrScraper MCP Server");
    assert.equal(serverVersion?.version, "0.1.0");
    const { tools } = await client.listTools(undefined, { timeout: 10_000 });
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [...EXPECTED_TOOLS],
    );
    for (const tool of tools) {
      assert.ok(tool.description, `${tool.name} must have a description`);
      assert.ok(tool.inputSchema, `${tool.name} must have an input schema`);
      assert.ok(tool.outputSchema, `${tool.name} must have an output schema`);
    }
    console.log("PASS protocol server metadata, ping, and seven tool schemas");

    const status = await call("status", {
      domain: new URL(values.url).hostname,
      from: "24h",
      to: "now",
    });
    const statusData = asObject(status.output.data, "status.data");
    assert.ok(statusData.account, "status must include account data");
    assert.ok(statusData.analytics, "status must include domain analytics");

    const fetched = await call("fetch", {
      url: values.url,
      format: "markdown",
      unblock: "auto",
      timeout: 90,
    });
    assert.equal(fetched.output.format, "markdown");
    assert.equal(fetched.output.url, values.url);
    assert.match(JSON.stringify(fetched.output.data), /Andorra/i);

    const scraped = await call("scrape", {
      url: values.url,
      prompt: "Extract the first country name shown on this page.",
      schema: {
        type: "object",
        properties: { country: { type: "string" } },
        required: ["country"],
      },
      agent: "general",
    });
    const scrapeRow = nestedData(scraped.output, "scrape");
    const resultId = String(scrapeRow.id || "");
    const scraperId = String(scrapeRow.scraperId || "");
    assert.ok(resultId, "scrape must return a result ID");
    assert.ok(scraperId, "scrape must return a scraper ID");
    assert.match(JSON.stringify(scrapeRow.data), /Andorra/i);

    const serp = await call("serp", {
      query_or_url: values["serp-query"],
      region: "us",
      language: "en",
      page: 1,
      format: "json",
    });
    assert.ok(serp.output.data !== null, "serp must return data");

    let listed = await call("results", {
      sort_field: "updatedAt",
      sort_order: "DESC",
      page_size: 25,
      page: 1,
      search: new URL(values.url).hostname,
    });
    let rows = responseRows(listed.output);
    if (!rows.some((row) => row.id === resultId)) {
      listed = await call("results", {
        sort_field: "updatedAt",
        sort_order: "DESC",
        page_size: 50,
        page: 1,
      });
      rows = responseRows(listed.output);
    }
    assert.ok(
      rows.some((row) => row.id === resultId),
      "results must include the scrape created by this run",
    );

    const original = await call("result", { result_id: resultId });
    const originalRow = nestedData(original.output, "result");
    assert.equal(originalRow.id, resultId);
    assert.equal(originalRow.scraperId, scraperId);

    const rerun = await call("rerun", {
      target: values.url,
      type: "ai",
      scraper_id: scraperId,
      max_depth: 2,
      max_pages: 1,
      limit: 10,
    });
    const rerunRow = nestedData(rerun.output, "rerun");
    const rerunResultId = String(rerunRow.id || "");
    assert.ok(rerunResultId, "rerun must return a result ID");
    assert.notEqual(rerunResultId, resultId, "rerun must create a new result");

    const rerunResult = await call("result", { result_id: rerunResultId });
    const rerunResultRow = nestedData(rerunResult.output, "rerun result");
    assert.equal(rerunResultRow.id, rerunResultId);
    assert.equal(rerunResultRow.scraperId, scraperId);

    assert.deepEqual(new Set(completed), new Set(EXPECTED_TOOLS));
    console.log(
      `PASS lifecycle scrape result ${resultId.slice(0, 8)}… -> rerun result ${rerunResultId.slice(0, 8)}…`,
    );
    console.log(
      "\nLive MCP E2E passed: all seven tools reached the real MrScraper service.",
    );
  } catch (error) {
    if (serverStderr.trim()) {
      console.error(
        `Server stderr:\n${sanitizeMessage(serverStderr.trim(), token)}`,
      );
    }
    throw new Error(sanitizeMessage(error, token));
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(sanitizeMessage(error, ""));
  process.exitCode = 1;
});
