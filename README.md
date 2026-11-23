# MrScraper MCP Server

![MrScraper](./assets/mrscraper-banner.jpeg)

An MCP server exposing the seven MrScraper services through hosted HTTP or local stdio.

## Overview

Seven services share the same descriptions, parameter meanings, and defaults across the CLI, SDKs, and integrations. Names, types, authentication, and code examples follow each surface's conventions. See the [API Reference](https://docs.mrscraper.com/docs/api/overview).

| Service                             | Public name      | Description                                                                                                                     |
| ----------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [Status](#status)                   | `status`         | Return the raw account status API response without summarizing, redacting body fields, or adding calculated fields.             |
| [Scrape HTML](#scrape-html)         | `scrapeHtml`     | Retrieve the raw HTML of a page. Browser rendering is optional.                                                                 |
| [Scrape Markdown](#scrape-markdown) | `scrapeMarkdown` | Retrieve a page as Markdown. Including HTML also enables browser rendering and returns both outputs as JSON.                    |
| [Get screenshot](#get-screenshot)   | `getScreenshot`  | Capture a base64 screenshot of the full page or top viewport. Browser rendering is always enabled.                              |
| [Scrape brand](#scrape-brand)       | `scrapeBrand`    | Extract a website's colors, typography, logos, and social links as JSON.                                                        |
| [Scrape JSON](#scrape-json)         | `scrapeJson`     | Extract structured JSON from a page using a natural-language prompt. Append Json Schema: and a JSON schema to shape the output. |
| [Web search](#web-search)           | `webSearch`      | Search the web and return ranked results with titles, URLs, descriptions, and sources.                                          |

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

### Page controls

HTML, Markdown, screenshots, and JSON extraction share `url`, `timeout`, `geoCode`, `proxyCountry`, `super`, `waitUntil`, `proxy`, `maxRetries`, and `saveResult` (using the naming style shown below). Page defaults are 300 seconds, US geolocation/proxy country, real-device routing off, and dashboard saving off. Omitted retry limits mean no limit. Exact types, defaults, and standard descriptions appear in each service table.

### Loading controls

HTML, Markdown, and screenshots additionally accept `blockResources`, `waitForSelector`, and `returnCookie`. JSON extraction does not accept these controls. Browser rendering is optional for HTML, Markdown, and JSON; screenshots always enable it. Markdown with HTML also enables browser rendering.

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

Retrieve the raw HTML of a page. Browser rendering is optional.

#### Parameters

| Parameter          | HTTP field         | Type                                                               | Default              | Description                                                                                     |
| ------------------ | ------------------ | ------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| `url`              | `url`              | string                                                             | Required             | Absolute HTTP or HTTPS URL of the page to process.                                              |
| `timeout`          | `timeout`          | integer                                                            | `300`                | Page load timeout in seconds, from 1 to 300. The HTTP request allows 30 additional seconds.     |
| `geoCode`          | `geoCode`          | string                                                             | `"us"`               | Two-letter country code to load the page from, sent in lowercase.                               |
| `proxyCountry`     | `proxyCountry`     | string                                                             | `"us"`               | Two-letter country code of the proxy server, sent in lowercase.                                 |
| `super`            | `super`            | boolean                                                            | `false`              | Whether to route the request through real devices.                                              |
| `waitUntil`        | `waitUntil`        | string: `domcontentloaded`, `load`, `networkidle0`, `networkidle2` | `"domcontentloaded"` | Navigation completion event to wait for: domcontentloaded, load, networkidle0, or networkidle2. |
| `proxy`            | `proxy`            | string                                                             | Omitted              | Custom proxy URL used to load the page.                                                         |
| `maxRetries`       | `maxRetries`       | integer                                                            | Omitted              | Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.          |
| `saveResult`       | `saveResult`       | boolean                                                            | `false`              | Whether to save the result to the dashboard Result tab.                                         |
| `blockResources`   | `blockResources`   | boolean                                                            | `false`              | Whether to block images, fonts, and stylesheets while loading the page.                         |
| `waitForSelector`  | `waitForSelector`  | string                                                             | Omitted              | Wait for the page to contain the specified CSS selector before returning the result.            |
| `returnCookie`     | `returnCookie`     | boolean                                                            | `false`              | Whether to include browser session cookies in the response.                                     |
| `browserRendering` | `browserRendering` | boolean                                                            | `false`              | Whether to render the page in a browser before returning the result.                            |
| `warmStart`        | `warmStart`        | boolean                                                            | `false`              | Whether to enable warm start for more reliable scraping, at the cost of additional latency.     |

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

The default response body is HTML text. Additional controls can cause the API to return JSON; the returned structure is preserved.

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

Retrieve a page as Markdown. Including HTML also enables browser rendering and returns both outputs as JSON.

#### Parameters

| Parameter          | HTTP field         | Type                                                               | Default              | Description                                                                                     |
| ------------------ | ------------------ | ------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| `url`              | `url`              | string                                                             | Required             | Absolute HTTP or HTTPS URL of the page to process.                                              |
| `timeout`          | `timeout`          | integer                                                            | `300`                | Page load timeout in seconds, from 1 to 300. The HTTP request allows 30 additional seconds.     |
| `geoCode`          | `geoCode`          | string                                                             | `"us"`               | Two-letter country code to load the page from, sent in lowercase.                               |
| `proxyCountry`     | `proxyCountry`     | string                                                             | `"us"`               | Two-letter country code of the proxy server, sent in lowercase.                                 |
| `super`            | `super`            | boolean                                                            | `false`              | Whether to route the request through real devices.                                              |
| `waitUntil`        | `waitUntil`        | string: `domcontentloaded`, `load`, `networkidle0`, `networkidle2` | `"domcontentloaded"` | Navigation completion event to wait for: domcontentloaded, load, networkidle0, or networkidle2. |
| `proxy`            | `proxy`            | string                                                             | Omitted              | Custom proxy URL used to load the page.                                                         |
| `maxRetries`       | `maxRetries`       | integer                                                            | Omitted              | Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.          |
| `saveResult`       | `saveResult`       | boolean                                                            | `false`              | Whether to save the result to the dashboard Result tab.                                         |
| `blockResources`   | `blockResources`   | boolean                                                            | `false`              | Whether to block images, fonts, and stylesheets while loading the page.                         |
| `waitForSelector`  | `waitForSelector`  | string                                                             | Omitted              | Wait for the page to contain the specified CSS selector before returning the result.            |
| `returnCookie`     | `returnCookie`     | boolean                                                            | `false`              | Whether to include browser session cookies in the response.                                     |
| `browserRendering` | `browserRendering` | boolean                                                            | `false`              | Whether to render the page in a browser before returning the result.                            |
| `warmStart`        | `warmStart`        | boolean                                                            | `false`              | Whether to enable warm start for more reliable scraping, at the cost of additional latency.     |
| `html`             | `html`             | boolean                                                            | `false`              | Whether to include the page HTML in the response.                                               |

#### Example

```json
{
  "name": "scrapeMarkdown",
  "arguments": {
    "url": "https://example.com",
    "html": true,
    "warmStart": true
  }
}
```

#### Response

The default response body is Markdown text. Enabling HTML returns JSON containing both HTML and Markdown.

MCP tool result; the API response envelope is in `structuredContent`:

**With html enabled**

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
      "html": "<html>...</html>",
      "markdown": "# Example page\n\n..."
    },
    "headers": {
      "content-type": "application/json"
    }
  }
}
```

**Default Markdown text**

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

Capture a base64 screenshot of the full page or top viewport. Browser rendering is always enabled.

#### Parameters

| Parameter         | HTTP field        | Type                                                               | Default              | Description                                                                                     |
| ----------------- | ----------------- | ------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| `url`             | `url`             | string                                                             | Required             | Absolute HTTP or HTTPS URL of the page to process.                                              |
| `timeout`         | `timeout`         | integer                                                            | `300`                | Page load timeout in seconds, from 1 to 300. The HTTP request allows 30 additional seconds.     |
| `geoCode`         | `geoCode`         | string                                                             | `"us"`               | Two-letter country code to load the page from, sent in lowercase.                               |
| `proxyCountry`    | `proxyCountry`    | string                                                             | `"us"`               | Two-letter country code of the proxy server, sent in lowercase.                                 |
| `super`           | `super`           | boolean                                                            | `false`              | Whether to route the request through real devices.                                              |
| `waitUntil`       | `waitUntil`       | string: `domcontentloaded`, `load`, `networkidle0`, `networkidle2` | `"domcontentloaded"` | Navigation completion event to wait for: domcontentloaded, load, networkidle0, or networkidle2. |
| `proxy`           | `proxy`           | string                                                             | Omitted              | Custom proxy URL used to load the page.                                                         |
| `maxRetries`      | `maxRetries`      | integer                                                            | Omitted              | Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.          |
| `saveResult`      | `saveResult`      | boolean                                                            | `false`              | Whether to save the result to the dashboard Result tab.                                         |
| `blockResources`  | `blockResources`  | boolean                                                            | `false`              | Whether to block images, fonts, and stylesheets while loading the page.                         |
| `waitForSelector` | `waitForSelector` | string                                                             | Omitted              | Wait for the page to contain the specified CSS selector before returning the result.            |
| `returnCookie`    | `returnCookie`    | boolean                                                            | `false`              | Whether to include browser session cookies in the response.                                     |
| `screenshot`      | `screenshot`      | string: `full`, `top`                                              | `"full"`             | Screenshot area to capture: full for the entire page or top for the top viewport.               |
| `html`            | `html`            | boolean                                                            | `true`               | Whether to include the page HTML in the response.                                               |
| `markdown`        | `markdown`        | boolean                                                            | `false`              | Whether to include the page Markdown in the response.                                           |

#### Example

```json
{
  "name": "getScreenshot",
  "arguments": {
    "url": "https://example.com",
    "screenshot": "top",
    "html": false,
    "markdown": true
  }
}
```

#### Response

The response body contains a base64 screenshot and requested page outputs. The API can still include HTML when HTML output is disabled.

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
      "html": "<html>...</html>",
      "screenshot": "BASE64_PNG_DATA",
      "markdown": "# Example page\n\n..."
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

| Parameter | HTTP field | Type   | Default  | Description                                        |
| --------- | ---------- | ------ | -------- | -------------------------------------------------- |
| `url`     | `url`      | string | Required | Absolute HTTP or HTTPS URL of the page to process. |

The HTTP deadline is fixed at 120 seconds. It is not a service parameter.

The request uses `action=brand-scraping` and `bundle=none`; page controls are not accepted.

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

| Parameter          | HTTP field         | Type                                                               | Default                                       | Description                                                                                             |
| ------------------ | ------------------ | ------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `url`              | `url`              | string                                                             | Required                                      | Absolute HTTP or HTTPS URL of the page to process.                                                      |
| `timeout`          | `timeout`          | integer                                                            | `300`                                         | Page load timeout in seconds, from 1 to 300. The HTTP request allows 30 additional seconds.             |
| `geoCode`          | `geoCode`          | string                                                             | `"us"`                                        | Two-letter country code to load the page from, sent in lowercase.                                       |
| `proxyCountry`     | `proxyCountry`     | string                                                             | `"us"`                                        | Two-letter country code of the proxy server, sent in lowercase.                                         |
| `super`            | `super`            | boolean                                                            | `false`                                       | Whether to route the request through real devices.                                                      |
| `waitUntil`        | `waitUntil`        | string: `domcontentloaded`, `load`, `networkidle0`, `networkidle2` | `"domcontentloaded"`                          | Navigation completion event to wait for: domcontentloaded, load, networkidle0, or networkidle2.         |
| `proxy`            | `proxy`            | string                                                             | Omitted                                       | Custom proxy URL used to load the page.                                                                 |
| `maxRetries`       | `maxRetries`       | integer                                                            | Omitted                                       | Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.                  |
| `saveResult`       | `saveResult`       | boolean                                                            | `false`                                       | Whether to save the result to the dashboard Result tab.                                                 |
| `prompt`           | `prompt`           | string                                                             | `"Extract all data as complete as possible."` | Instructions describing the data to extract. Append Json Schema: and a JSON schema to shape the output. |
| `browserRendering` | `browserRendering` | boolean                                                            | `false`                                       | Whether to render the page in a browser before returning the result.                                    |
| `html`             | `html`             | boolean                                                            | `false`                                       | Whether to include the page HTML in the response.                                                       |
| `screenshot`       | `screenshot`       | boolean                                                            | `false`                                       | Whether to include a base64 screenshot in the response.                                                 |

The request uses `agent=general` and GET. If the encoded URL exceeds 8,000 characters, it switches to POST with `url`, `prompt`, and `agent` in the body; page controls remain in the query.

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

Extraction results are in the API body's data field and follow the requested schema. Response metadata includes thread_id, token_usage, status, error, runtime, and cookies. html, markdown, and screenshot can be empty strings when not requested.

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
      "html": "",
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

| Parameter    | HTTP field   | Type    | Default  | Description                                                                                       |
| ------------ | ------------ | ------- | -------- | ------------------------------------------------------------------------------------------------- |
| `query`      | `query`      | string  | Required | Search query text, trimmed before sending, containing 1 to 1000 characters.                       |
| `country`    | `country`    | string  | `"us"`   | Two-letter country code to search from, sent in lowercase.                                        |
| `numResults` | `numResults` | integer | `10`     | Number of search results to request, as an integer from 10 to 100. Fewer results may be returned. |

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

Every client gets the same seven tools. ChatGPT and Codex sign-ins (the `/mcp/chatgpt` route, or `/mcp` with a `https://chatgpt.com/oauth/` client) get the page tools without `super` and `proxy`, and a call that sets either is rejected (`super` stays `false`). Their `proxyCountry` has no default: omitted, no proxy country is sent (other clients send `us`). Every other input and default is the same on all surfaces, and `/mcp/chatgpt` shares the sign-in audience of `/mcp`. Tools authenticate through the connection.

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

All six scraping/search tools require `scrape:read`. Status requires `account:read`. These are the only application scopes advertised in OAuth resource metadata; authorization-server metadata also offers `offline_access` for refresh tokens. The scraper gateway checks the same token again: `GET` requests need `scrape:read`, and the `POST` that `scrapeJson` switches to above 8,000 encoded URL characters needs `scrape:write`, so OAuth connections without that scope receive 403 for such requests. HTML, Markdown, screenshot, and JSON tools advertise `readOnlyHint: false` because `saveResult` can persist data; status, brand, and search advertise `readOnlyHint: true`. All tools advertise `destructiveHint: false`; status has `openWorldHint: false` and scraping/search have `openWorldHint: true`.

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

Status keeps its tool name and returns the raw API body. Replace `scraperAPI` with `scrapeHtml`, `scrapeMarkdown`, or `getScreenshot`. Brand and JSON extraction are separate tools. Search uses `query`, `country`, and `numResults`. All clients now receive the full CLI-aligned input schema. Refresh cached tool definitions. OAuth connections need `scrape:read` for scraping/search; connections that already hold it keep working. API keys continue to work without OAuth scope approval.

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
