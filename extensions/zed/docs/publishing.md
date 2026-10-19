# Publishing MrScraper for Zed

This extension lives at `extensions/zed` in the public [mrscraper-com/mrscraper-mcp repository](https://github.com/mrscraper-com/mrscraper-mcp). Its first extension version is `0.1.0`, independent of the pinned MCP package version `0.2.1`. The Rust launcher uses `zed_extension_api` `0.7.0`.

## Review and test

Read Zed's [publishing prerequisites](https://zed.dev/docs/extensions/publishing/prerequisites), [license requirements](https://zed.dev/docs/extensions/publishing/license-requirements), and [publishing guide](https://zed.dev/docs/extensions/publishing/publishing-guide). Complete the [manual Zed checks](../README.md#develop-and-test-locally) with a real account before submitting. Record your environment and results, including all three tools and missing-key recovery.

The registry's [AI policy](https://github.com/zed-industries/extensions/blob/main/AI_POLICY.md) requires a responsible human contributor. It states: “Autonomous agents are not allowed to be used for contributing to this project”. A human must review the code, understand the extension, submit the PR, and write its description and maintainer replies in their own words. This document provides release instructions, not PR or comment prose.

## Publish the source commit first

Review and commit the extension files in the MrScraper MCP repository, then push that commit to a public branch. Verify that another clone can fetch it. A commit present only in this local submodule cannot be used by Zed's publisher. Keep the extension manifest and Cargo package version aligned at `0.1.0`, and include the MIT license.

For the registry checkout, use the HTTPS submodule URL:

```ini
[submodule "extensions/mcp-server-mrscraper"]
    path = extensions/mcp-server-mrscraper
    url = https://github.com/mrscraper-com/mrscraper-mcp.git
```

Point the submodule at the reviewed, pushed commit. It must remain reachable from a public branch. Confirm the registry diff contains the intended Git submodule commit; uncommitted files inside it are excluded from that pointer.

## Submit the registry change

In your fork of `zed-industries/extensions`, the top-level `extensions.toml` entry is:

```toml
[mcp-server-mrscraper]
submodule = "extensions/mcp-server-mrscraper"
path = "extensions/zed"
version = "0.1.0"
```

From the registry root, run:

```sh
pnpm sort-extensions
git diff --check
git diff --submodule=log
git status --short
```

Review the manifest, submodule pointer, and sorted registry files. Have the human maintainer open one PR for this extension using their own explanation and test evidence. Zed packages and publishes accepted extensions after merge; preparing these files alone does not create a listing on [zed.dev/extensions](https://zed.dev/extensions/). Follow the current [PR rules](https://zed.dev/docs/extensions/publishing/publishing-guide#pull-request-rules).

## Official MCP registry and future updates

Zed [plans to deprecate MCP server extensions](https://zed.dev/docs/extensions/mcp-extensions) in favor of the [official MCP registry](https://registry.modelcontextprotocol.io/). Maintain the hosted connection documented in the README and publish the server to that registry as well.

The MCP repository already contains [`server.json`](../../../server.json), naming `io.github.mrscraper-com/mrscraper-mcp` and the hosted Streamable HTTP endpoint. That file is metadata, not proof of publication: the server's live MCP registry publication status has not been verified. Check the current registry entry and official publishing instructions before publishing or updating it.

For a later Zed release, test the new pinned server package, increment the extension version, push the source commit, and update both the registry version and submodule pointer. Follow [Zed's update guide](https://zed.dev/docs/extensions/publishing/updating-and-maintenance).
