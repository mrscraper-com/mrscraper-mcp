# MrScraper MCP Server

![MrScraper](./assets/mrscraper-banner.jpeg)

An MCP server exposing the seven MrScraper services through hosted HTTP or local stdio.

## Overview

Seven services. Each tool takes the parameters on its page in the [API Reference](https://docs.mrscraper.com/docs/api/overview), with the integration rules in [Shared parameters](#shared-parameters). Names, types, authentication, and code examples follow MCP conventions.

| Service                             | Public name      | Description                                                                                                                         |
| ----------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [Status](#status)                   | `status`         | Return the raw account status API response without summarizing, redacting body fields, or adding calculated fields.                 |
| [Scrape HTML](#scrape-html)         | `scrapeHtml`     | Retrieve the raw HTML of a page. Browser rendering and a screenshot are optional.                                                   |
| [Scrape Markdown](#scrape-markdown) | `scrapeMarkdown` | Retrieve a page as Markdown. Browser rendering is optional.                                                                         |
| [Get screenshot](#get-screenshot)   | `getScreenshot`  | Capture a base64 PNG screenshot of the full page, the top viewport, or a custom viewport size. Browser rendering is always enabled. |
| [Scrape brand](#scrape-brand)       | `scrapeBrand`    | Extract a website's colors, typography, logos, and social links as JSON.                                                            |
| [Scrape JSON](#scrape-json)         | `scrapeJson`     | Extract structured JSON from a page using a natural-language prompt. Append Json Schema: and a JSON schema to shape the output.     |
| [Web search](#web-search)           | `webSearch`      | Search the web and return ranked results with titles, URLs, descriptions, and sources.                                              |

## Installation

The hosted server requires an MCP client with Streamable HTTP support. Local execution requires Node.js 20 or newer.

Configure the hosted endpoint in your MCP client:

```json
{ "mcpServers": { "mrscraper": { "url": "https://mcp.mrscraper.com/mcp" } } }
```

For local stdio, configure the client to start `npx -y @mrscraper/mcp@latest`. The full configuration is in [Integration features](#integration-features).

## Authentication

Obtain an API key from [the MrScraper app](https://app.mrscraper.com/api-tokens). API key used to authenticate the request.

The hosted server supports browser sign-in through OAuth 2.1. Approve `account:read` for status and `scrape:read` for all six scraping/search tools. Connections that already hold `scrape:read` keep working; others must reconnect and approve it for scraping/search.

Clients without OAuth can send an API key as `Authorization: Bearer YOUR_TOKEN`. Local stdio reads `MRSCRAPER_API_KEY`, then `MRSCRAPER_API_TOKEN`. Tools do not accept tokens as arguments.

```json
{
  "mcpServers": {
    "mrscraper": {
      "url": "https://mcp.mrscraper.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

## Quickstart

```json
{
  "name": "scrapeHtml",
  "arguments": {
    "url": "https://example.com",
    "browserRendering": true,
    "warmStart": true,
    "waitForSelector": "body",
    "timeout": 120,
    "maxRetries": 0
  }
}
```

Examples use `example.com` as the sample target. Replace it for your use case. Live scraping and search calls consume account quota.

Response examples show selected keys and types observed in live API responses. Values are placeholders; page content, base64 images, and arrays are abbreviated. Actual responses may contain additional fields.

## Shared parameters

The tools take the parameters documented for each service in the [API reference](https://docs.mrscraper.com/docs/api/scraper-api/scrape-html), with these integration rules:

- An optional parameter is sent only when you set it, so the API's own default applies otherwise. For example, leaving `browserRendering` out loads the page without a browser first and switches to one if the request is blocked, while `false` never uses a browser.
- HTML, Markdown, screenshots, and JSON extraction always send `saveResult=true`, so every result is saved to the dashboard Result tab. They send `maxAge=0` (always scrape fresh) unless you set a cache age.
- Each tool sends its own fixed values: `html=true` and `markdown=false` for HTML; `markdown=true`, `html=false`, and `screenshot=false` for Markdown; `browserRendering=true`, `html=false`, and `markdown=false` for screenshots; `agent=general` for JSON; `action=brand-scraping` and `bundle=none` for brand; `action=websearch` for search.
- `tokenCap`, `action`, real-device routing, custom proxies, proxy countries, cookies, and navigation events are not available. A call that sets one of them is rejected.

Every tool's table below lists its exact parameters, types, and the defaults the server sends.

## Service reference

### Status

#### Description

Return the raw account status API response without summarizing, redacting body fields, or adding calculated fields.

#### Parameters

This service takes no service parameters. Authentication is configured separately.

The HTTP deadline is fixed at 600 seconds. It is not a service parameter.

#### Example

```json
{
  "name": "status",
  "arguments": {}
}
```

#### Response

The API body contains message and data. Account details remain nested in data, including subscriptionItem and scraperAllowance. The response envelope therefore exposes account details at data.data. Sensitive response headers are removed.

MCP tool result; the API response envelope is in `structuredContent`:

**Success response**

```json
{
  "content": [
    {
      "type": "text",
      "text": "[Formatted JSON matching structuredContent]"
    }
  ],
  "structuredContent": {
    "status_code": 200,
    "data": {
      "message": "Example response",
      "data": {
        "id": "ACCOUNT_ID",
        "tokenLimit": 100000,
        "tokenUsage": 2500,
        "stripeStatus": "active",
        "user": {
          "name": "Example user",
          "email": "user@example.com",
          "isVerified": true
        },
        "subscriptionItem": {
          "name": "Example plan",
          "tokenLimit": 100000
        },
        "scraperAllowance": {
          "remaining": 97500,
          "plans": [
            {
              "remaining": 97500
            }
          ]
        }
      }
    },
    "headers": {
      "content-type": "application/json; charset=utf-8"
    }
  }
}
```

### Scrape HTML

#### Description

Retrieve the raw HTML of a page. Browser rendering and a screenshot are optional.

#### Parameters

| Parameter          | HTTP field         | Type                                                  | Default  | Description                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ------------------ | ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`              | `url`              | string                                                | Required | URL of the page to scrape. Must include the protocol (https://).                                                                                                                                                                                                                                                                                                                                                   |
| `browserRendering` | `browserRendering` | boolean                                               | Omitted  | Controls whether the page is loaded in a browser. Leave it out to load the page without a browser first and switch to a browser automatically if the request is blocked. Set true to always load the page in a browser, which JavaScript-heavy sites, SPAs, and pages that load content dynamically need. Set false to never use a browser.                                                                        |
| `timeout`          | `timeout`          | integer                                               | Omitted  | Maximum seconds to wait for the scrape before the request times out, from 1 to 330. Increase for slow or complex pages. Defaults to 300.                                                                                                                                                                                                                                                                           |
| `warmStart`        | `warmStart`        | boolean                                               | Omitted  | Opens the site's home page first to warm the session before loading the target URL. Useful for sites that expect a normal browsing session before deeper pages.                                                                                                                                                                                                                                                    |
| `blockResources`   | `blockResources`   | boolean                                               | Omitted  | Blocks images, fonts, and stylesheets from loading. Speeds up scraping and reduces bandwidth usage.                                                                                                                                                                                                                                                                                                                |
| `waitForSelector`  | `waitForSelector`  | string                                                | Omitted  | Waits until a specific CSS selector or text appears on the page before returning it, such as #results. Up to 500 characters. Useful for content that loads asynchronously after the initial page load.                                                                                                                                                                                                             |
| `geoCode`          | `geoCode`          | string                                                | Omitted  | Two-letter country code to load the page from, such as us or gb. Defaults to the United States.                                                                                                                                                                                                                                                                                                                    |
| `maxAge`           | `maxAge`           | integer                                               | `0`      | Serves a cached result of the same request when it is newer than this age, in milliseconds, such as 86400000 for 1 day. Up to 604800000 (7 days). 0, the default, always scrapes fresh. A cached result costs the same tokens as the original scrape.                                                                                                                                                              |
| `maxRetries`       | `maxRetries`       | integer                                               | Omitted  | Maximum number of retries for the request. Omit for no limit.                                                                                                                                                                                                                                                                                                                                                      |
| `screenshot`       | `screenshot`       | string: `full`, `top`, or `<width>x<height>[-<zoom>]` | Omitted  | Also captures a screenshot of the rendered page as a base64-encoded PNG: full captures the entire scroll height, top captures the first viewport, and `<width>x<height>` sets the viewport size in pixels with an optional `-<zoom>` percent, such as 1280x800 or 1920x1080-75. Width and height range from 100 to 3840, zoom from 25 to 300. Setting it forces browser rendering. Leave it out for no screenshot. |

Always sent: `html=true`, `markdown=false`, and `saveResult=true`.

#### Example

```json
{
  "name": "scrapeHtml",
  "arguments": {
    "url": "https://example.com",
    "browserRendering": true,
    "warmStart": true,
    "waitForSelector": "body",
    "timeout": 120,
    "maxRetries": 0
  }
}
```

#### Response

The default response body is HTML text. Setting `screenshot` can make the API return JSON with the HTML and the base64 screenshot; the returned structure is preserved.

MCP tool result; the API response envelope is in `structuredContent`:

**Success response**

```json
{
  "content": [
    {
      "type": "text",
      "text": "[Formatted JSON matching structuredContent]"
    }
  ],
  "structuredContent": {
    "status_code": 200,
    "data": "<html><body>Example page content...</body></html>",
    "headers": {
      "content-type": "text/html; charset=utf-8"
    }
  }
}
```

### Scrape Markdown

#### Description

Retrieve a page as Markdown. Browser rendering is optional.

#### Parameters

| Parameter          | HTTP field         | Type    | Default  | Description                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`              | `url`              | string  | Required | URL of the page to scrape. Must include the protocol (https://).                                                                                                                                                                                                                                                                            |
| `browserRendering` | `browserRendering` | boolean | Omitted  | Controls whether the page is loaded in a browser. Leave it out to load the page without a browser first and switch to a browser automatically if the request is blocked. Set true to always load the page in a browser, which JavaScript-heavy sites, SPAs, and pages that load content dynamically need. Set false to never use a browser. |
| `timeout`          | `timeout`          | integer | Omitted  | Maximum seconds to wait for the scrape before the request times out, from 1 to 330. Increase for slow or complex pages. Defaults to 300.                                                                                                                                                                                                    |
| `geoCode`          | `geoCode`          | string  | Omitted  | Two-letter country code to load the page from, such as us or gb. Defaults to the United States.                                                                                                                                                                                                                                             |
| `warmStart`        | `warmStart`        | boolean | Omitted  | Opens the site's home page first to warm the session before loading the target URL. Useful for sites that expect a normal browsing session before deeper pages.                                                                                                                                                                             |
| `blockResources`   | `blockResources`   | boolean | Omitted  | Blocks images, fonts, and stylesheets from loading. Speeds up scraping and reduces bandwidth usage.                                                                                                                                                                                                                                         |
| `waitForSelector`  | `waitForSelector`  | string  | Omitted  | Waits until a specific CSS selector or text appears on the page before returning it, such as #results. Up to 500 characters. Useful for content that loads asynchronously after the initial page load.                                                                                                                                      |
| `maxAge`           | `maxAge`           | integer | `0`      | Serves a cached result of the same request when it is newer than this age, in milliseconds, such as 86400000 for 1 day. Up to 604800000 (7 days). 0, the default, always scrapes fresh. A cached result costs the same tokens as the original scrape.                                                                                       |
| `maxRetries`       | `maxRetries`       | integer | Omitted  | Maximum number of retries for the request. Omit for no limit.                                                                                                                                                                                                                                                                               |

Always sent: `markdown=true`, `html=false`, `screenshot=false`, and `saveResult=true`.

#### Example

```json
{
  "name": "scrapeMarkdown",
  "arguments": {
    "url": "https://example.com",
    "warmStart": true
  }
}
```

#### Response

The response body is Markdown text.

MCP tool result; the API response envelope is in `structuredContent`:

**Markdown text**

```json
{
  "content": [
    {
      "type": "text",
      "text": "[Formatted JSON matching structuredContent]"
    }
  ],
  "structuredContent": {
    "status_code": 200,
    "data": "# Example page\n\nExample Markdown content...",
    "headers": {
      "content-type": "text/markdown; charset=utf-8"
    }
  }
}
```

### Get screenshot

#### Description

Capture a base64 PNG screenshot of the full page, the top viewport, or a custom viewport size. Browser rendering is always enabled.

#### Parameters

| Parameter         | HTTP field        | Type                                                  | Default  | Description                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ----------------- | ----------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`             | `url`             | string                                                | Required | URL of the page to scrape. Must include the protocol (https://).                                                                                                                                                                                                                                                                       |
| `screenshot`      | `screenshot`      | string: `full`, `top`, or `<width>x<height>[-<zoom>]` | `"full"` | Screenshot area: full captures the entire scroll height (the default), top captures the first viewport, and `<width>x<height>` sets the viewport size in pixels with an optional `-<zoom>` percent, such as 1280x800 or 1920x1080-75. Width and height range from 100 to 3840, zoom from 25 to 300. The image is a base64-encoded PNG. |
| `timeout`         | `timeout`         | integer                                               | Omitted  | Maximum seconds to wait for the scrape before the request times out, from 1 to 330. Increase for slow or complex pages. Defaults to 300.                                                                                                                                                                                               |
| `geoCode`         | `geoCode`         | string                                                | Omitted  | Two-letter country code to load the page from, such as us or gb. Defaults to the United States.                                                                                                                                                                                                                                        |
| `waitForSelector` | `waitForSelector` | string                                                | Omitted  | Waits until a specific CSS selector or text appears on the page before returning it, such as #results. Up to 500 characters. Useful for content that loads asynchronously after the initial page load.                                                                                                                                 |
| `maxAge`          | `maxAge`          | integer                                               | `0`      | Serves a cached result of the same request when it is newer than this age, in milliseconds, such as 86400000 for 1 day. Up to 604800000 (7 days). 0, the default, always scrapes fresh. A cached result costs the same tokens as the original scrape.                                                                                  |
| `maxRetries`      | `maxRetries`      | integer                                               | Omitted  | Maximum number of retries for the request. Omit for no limit.                                                                                                                                                                                                                                                                          |

Always sent: `browserRendering=true`, `html=false`, `markdown=false`, and `saveResult=true`.

#### Example

```json
{
  "name": "getScreenshot",
  "arguments": {
    "url": "https://example.com",
    "screenshot": "1280x800"
  }
}
```

#### Response

The response body contains the base64 screenshot. The API can still include an html field, empty or not, although HTML output is off.

MCP tool result; the API response envelope is in `structuredContent`:

**Success response**

```json
{
  "content": [
    {
      "type": "text",
      "text": "[Formatted JSON matching structuredContent]"
    }
  ],
  "structuredContent": {
    "status_code": 200,
    "data": {
      "screenshot": "BASE64_PNG_DATA"
    },
    "headers": {
      "content-type": "application/json; charset=utf-8"
    }
  }
}
```

### Scrape brand

#### Description

Extract a website's colors, typography, logos, and social links as JSON.

#### Parameters

| Parameter | HTTP field | Type   | Default  | Description                                                      |
| --------- | ---------- | ------ | -------- | ---------------------------------------------------------------- |
| `url`     | `url`      | string | Required | URL of the page to scrape. Must include the protocol (https://). |

The HTTP deadline is fixed at 120 seconds. It is not a service parameter.

The request always sends `action=brand-scraping` and `bundle=none`. No other parameters are accepted.

#### Example

```json
{
  "name": "scrapeBrand",
  "arguments": {
    "url": "https://example.com"
  }
}
```

#### Response

The API body contains message and a data object with job_id, status, url, final_url, brand, and error. Brand details are available at data.data.brand in the response envelope.

MCP tool result; the API response envelope is in `structuredContent`:

**Success response**

```json
{
  "content": [
    {
      "type": "text",
      "text": "[Formatted JSON matching structuredContent]"
    }
  ],
  "structuredContent": {
    "status_code": 200,
    "data": {
      "data": {
        "job_id": "JOB_ID",
        "status": "succeeded",
        "url": "https://example.com",
        "final_url": "https://example.com",
        "brand": {
          "name": "Example brand",
          "colors": {
            "background": "#ffffff",
            "text": "#222222"
          },
          "typography": {
            "body": {
              "font_family": "Example font"
            }
          }
        },
        "error": null,
        "bundle_url": null
      },
      "message": "Example response"
    },
    "headers": {
      "content-type": "application/json"
    }
  }
}
```

### Scrape JSON

#### Description

Extract structured JSON from a page using a natural-language prompt. Append Json Schema: and a JSON schema to shape the output.

#### Parameters

| Parameter          | HTTP field         | Type    | Default  | Description                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`              | `url`              | string  | Required | URL of the page to scrape. Must include the protocol (https://).                                                                                                                                                                                                                                                                            |
| `prompt`           | `prompt`           | string  | Omitted  | Description of the data shape you want back, for example fields like title, price, and rating. The prompt only parses the scraped content; it cannot instruct the scraper itself. To shape the output with a JSON schema, append it to the prompt as a Json Schema: section. Defaults to "Extract all data as complete as possible."        |
| `html`             | `html`             | boolean | `true`   | Returns the raw HTML of the scraped page in the response. On by default; set false to leave it out.                                                                                                                                                                                                                                         |
| `screenshot`       | `screenshot`       | boolean | `false`  | Captures a screenshot of the rendered page as a base64-encoded image. Useful for verifying what the scraper actually saw. Off by default.                                                                                                                                                                                                   |
| `browserRendering` | `browserRendering` | boolean | Omitted  | Controls whether the page is loaded in a browser. Leave it out to load the page without a browser first and switch to a browser automatically if the request is blocked. Set true to always load the page in a browser, which JavaScript-heavy sites, SPAs, and pages that load content dynamically need. Set false to never use a browser. |
| `waitForSelector`  | `waitForSelector`  | string  | Omitted  | Waits until a specific CSS selector or text appears on the page before returning it, such as #results. Up to 500 characters. Useful for content that loads asynchronously after the initial page load.                                                                                                                                      |
| `warmStart`        | `warmStart`        | boolean | Omitted  | Opens the site's home page first to warm the session before loading the target URL. Useful for sites that expect a normal browsing session before deeper pages.                                                                                                                                                                             |
| `blockResources`   | `blockResources`   | boolean | Omitted  | Blocks images, fonts, and stylesheets from loading. Speeds up scraping and reduces bandwidth usage.                                                                                                                                                                                                                                         |
| `timeout`          | `timeout`          | integer | Omitted  | Maximum seconds to wait for the scrape before the request times out, from 1 to 330. Increase for slow or complex pages. Defaults to 300.                                                                                                                                                                                                    |
| `geoCode`          | `geoCode`          | string  | Omitted  | Two-letter country code to load the page from, such as us or gb. Defaults to the United States.                                                                                                                                                                                                                                             |
| `maxAge`           | `maxAge`           | integer | `0`      | Serves a cached result of the same request when it is newer than this age, in milliseconds, such as 86400000 for 1 day. Up to 604800000 (7 days). 0, the default, always scrapes fresh. A cached result costs the same tokens as the original scrape.                                                                                       |
| `maxRetries`       | `maxRetries`       | integer | Omitted  | Maximum number of retries for the request. Omit for no limit.                                                                                                                                                                                                                                                                               |

Always sent: `agent=general` and `saveResult=true`. The request uses GET. If the encoded URL exceeds 8,000 characters, it switches to POST with `url`, `prompt`, and `agent` in the body; the other settings stay in the query.

#### Example

```json
{
  "name": "scrapeJson",
  "arguments": {
    "url": "https://example.com",
    "prompt": "Extract the first 2 items with title and price. Json Schema: {\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"title\":{\"type\":\"string\"},\"price\":{\"type\":\"string\"}},\"required\":[\"title\",\"price\"]}}",
    "browserRendering": true
  }
}
```

#### Response

Extraction results are in the API body's data field and follow the requested schema. Response metadata includes thread_id, token_usage, status, error, runtime, and cookies. html is included by default; markdown, and screenshot unless requested, can be empty strings.

MCP tool result; the API response envelope is in `structuredContent`:

**Success response**

```json
{
  "content": [
    {
      "type": "text",
      "text": "[Formatted JSON matching structuredContent]"
    }
  ],
  "structuredContent": {
    "status_code": 200,
    "data": {
      "success": true,
      "data": [
        {
          "title": "Example item",
          "price": "10.00"
        }
      ],
      "thread_id": "THREAD_ID",
      "token_usage": 1,
      "html": "<html>...</html>",
      "markdown": "",
      "screenshot": "",
      "status": "Results ready",
      "error": "",
      "runtime": 1.23,
      "cookies": []
    },
    "headers": {
      "content-type": "application/json"
    }
  }
}
```

### Web search

#### Description

Search the web and return ranked results with titles, URLs, descriptions, and sources.

#### Parameters

| Parameter    | HTTP field   | Type    | Default  | Description                                                                              |
| ------------ | ------------ | ------- | -------- | ---------------------------------------------------------------------------------------- |
| `query`      | `query`      | string  | Required | The search query, from 1 to 1000 characters.                                             |
| `country`    | `country`    | string  | Omitted  | Two-letter country code to run the search from. Defaults to the United States.           |
| `numResults` | `numResults` | integer | Omitted  | How many results to return, from 10 to 100. The search may return fewer. Defaults to 10. |

Always sent: `action=websearch`.

The HTTP deadline is fixed at 120 seconds. It is not a service parameter.

#### Example

```json
{
  "name": "webSearch",
  "arguments": {
    "query": "site:example.com documentation",
    "country": "id",
    "numResults": 20
  }
}
```

#### Response

The API body contains success, message, a data array, and tokenUsage. Each result includes rank, title, url, description, and source.

MCP tool result; the API response envelope is in `structuredContent`:

**Success response**

```json
{
  "content": [
    {
      "type": "text",
      "text": "[Formatted JSON matching structuredContent]"
    }
  ],
  "structuredContent": {
    "status_code": 200,
    "data": {
      "success": true,
      "message": "Example response",
      "data": [
        {
          "rank": 1,
          "title": "Example result",
          "url": "https://example.com",
          "description": "Example result description.",
          "source": "example.com"
        }
      ],
      "tokenUsage": 1
    },
    "headers": {
      "content-type": "application/json; charset=utf-8"
    }
  }
}
```

## Response format

Successful services use an envelope containing `status_code`, `data`, and `headers`. The `data` field contains the API response body; its field names are not converted to the SDK's naming style. Status preserves the complete body without adding summary fields.

```json
{
  "content": [
    {
      "type": "text",
      "text": "[Formatted JSON matching structuredContent]"
    }
  ],
  "structuredContent": {
    "status_code": 200,
    "data": "<html><body>Example page content...</body></html>",
    "headers": {
      "content-type": "text/html; charset=utf-8"
    }
  }
}
```

Tool results include matching text content and `structuredContent`. The envelope lives in `structuredContent`. Credential-bearing response headers are filtered, and scraping/search credential metadata is redacted. Status preserves every field in the response body.

## Error handling

HTTP and network failures set `isError: true` on the MCP tool result and include `error` in the response envelope. Network failures use `status_code: null`. Invalid inputs are rejected before upstream calls. Authentication and missing OAuth scopes are enforced by the HTTP transport before tool execution.

## Integration features

### Configuration

Every client, ChatGPT and Codex included, gets the same seven tools with the same inputs and defaults. Tools authenticate through the connection.

For local stdio:

```json
{
  "mcpServers": {
    "mrscraper": {
      "command": "npx",
      "args": ["-y", "@mrscraper/mcp@latest"],
      "env": { "MRSCRAPER_API_KEY": "YOUR_TOKEN" }
    }
  }
}
```

For local HTTP, run `TRANSPORT=http npm start` after building; the default endpoint is `http://127.0.0.1:8000/mcp`. Docker runs can use `docker build -f docker/Dockerfile -t mrscraper-mcp .` and `docker run --rm -p 8000:8000 mrscraper-mcp`.

### Advanced usage

OAuth access tokens are verified against the configured issuer's JWKS and must include this resource in their audience. API keys are validated before tool execution. HTTP requests use their caller's credential; stdio reads server environment credentials. Metadata discovery is available at `/.well-known/oauth-protected-resource` and the `/mcp` path-suffixed variant.

All six scraping/search tools require `scrape:read`. Status requires `account:read`. These are the only application scopes advertised in OAuth resource metadata; authorization-server metadata also offers `offline_access` for refresh tokens. The scraper gateway checks the same token again: `GET` requests need `scrape:read`, and the `POST` that `scrapeJson` switches to above 8,000 encoded URL characters needs `scrape:write`, so OAuth connections without that scope receive 403 for such requests. HTML, Markdown, screenshot, and JSON tools advertise `readOnlyHint: false` because they always save the result to the dashboard Result tab (`saveResult=true`); status, brand, and search advertise `readOnlyHint: true`. All tools advertise `destructiveHint: false`; status has `openWorldHint: false` and scraping/search have `openWorldHint: true`.

Supported hosts can render self-contained search and account widgets. The account widget calculates its visual usage display locally from the raw tool result. Widget display does not change the raw status response.

| Environment variable             | Default                          | Purpose                                                                                                           |
| -------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `TRANSPORT`                      | `stdio`                          | Select `stdio` or `http`.                                                                                         |
| `HOST`                           | `127.0.0.1`                      | HTTP bind address; Docker uses `0.0.0.0`.                                                                         |
| `PORT`                           | `8000`                           | HTTP listen port.                                                                                                 |
| `MRSCRAPER_HTTP_AUTH`            | `1`                              | Enable HTTP bearer verification.                                                                                  |
| `MRSCRAPER_OAUTH`                | `1`                              | Accept OAuth access tokens.                                                                                       |
| `MRSCRAPER_MCP_PUBLIC_URL`       | `https://mcp.mrscraper.com`      | Public origin and token audience prefix.                                                                          |
| `MRSCRAPER_OAUTH_ISSUER`         | `https://api.app.mrscraper.com`  | Authorization issuer.                                                                                             |
| `MRSCRAPER_OAUTH_JWKS_URL`       | `<issuer>/.well-known/jwks.json` | Token verification keys.                                                                                          |
| `MRSCRAPER_ALLOWED_ORIGINS`      | unset                            | Additional exact browser origins.                                                                                 |
| `MRSCRAPER_GLAMA_CLAIM`          | hosted server's token            | Glama ownership token served at `/.well-known/glama.json` and `/mcp/.well-known/glama.json`; empty disables both. |
| `MRSCRAPER_API_BASE_URL`         | platform API                     | Account endpoint override.                                                                                        |
| `MRSCRAPER_FETCH_BASE_URL`       | Scraper API                      | Scraping/search endpoint override.                                                                                |
| `MRSCRAPER_LOG_HTTP_PAYLOAD`     | off                              | Request-body diagnostics for trusted environments.                                                                |
| `MRSCRAPER_LOG_HTTP_PAYLOAD_MAX` | `8192`                           | Maximum diagnostic payload length.                                                                                |

Trusted local origins, `claude.ai`, `chatgpt.com`, and configured exact origins are accepted. Service-to-service clients generally send no Origin header. Registry metadata is in `server.json`; `.github/workflows/publish-mcp-registry.yml` publishes matching immutable versions through GitHub OIDC.

### Troubleshooting

For 401, reconnect through OAuth or check the bearer key. For `insufficient_scope`, reconnect and approve `scrape:read` for scraping/search or `account:read` for status. Ensure the hosted URL ends in `/mcp` because the audience is bound to that resource. For origin errors, configure the exact browser origin in `MRSCRAPER_ALLOWED_ORIGINS`. Start a new client session if cached tool schemas are stale.

## Migration

Status keeps its tool name and returns the raw API body. Replace `scraperAPI` with `scrapeHtml`, `scrapeMarkdown`, or `getScreenshot`. Brand and JSON extraction are separate tools. Search uses `query`, `country`, and `numResults`. OAuth connections need `scrape:read` for scraping/search; connections that already hold it keep working. API keys continue to work without OAuth scope approval.

0.6.0 follows the API docs for every tool's inputs. Removed: `super`, `proxy`, `proxyCountry`, `waitUntil`, `returnCookie` and `saveResult` on the page tools, `html` on `scrapeMarkdown`, and `html`, `markdown` and `blockResources` on `getScreenshot`; a call that sets one is rejected. Page results are always saved to the Result tab. Optional inputs are sent only when set, so `geoCode`, `timeout`, `browserRendering`, `country` and `numResults` no longer default to `us`, `300`, `false`, `us` and `10` on our side (the API applies its own defaults). Added: `maxAge` on the page tools, `screenshot` on `scrapeHtml`, custom viewport sizes on `getScreenshot`, and `waitForSelector`, `warmStart` and `blockResources` on `scrapeJson`, whose `html` now defaults to `true`. The ChatGPT-only `/mcp/chatgpt` endpoint is gone; ChatGPT and Codex use `/mcp` like every client. Refresh cached tool definitions.

## Development and testing

### Automated checks

The automated suite checks service behavior without production API calls.

```bash
npm ci
npm test
npm run lint
npm run format:check
npm run build
```

### Manual checks

The following commands call the live API using your credentials and consume quota.

```bash
npm run test:manual -- status
npm run test:manual -- scrapeHtml --url https://example.com
npm run test:manual -- webSearch --query "site:example.com documentation"
npm run test:e2e
```

## License

MIT. See [LICENSE](./LICENSE).
