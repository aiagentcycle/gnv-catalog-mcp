# Good Nature Vibe Catalog MCP server

[![CI](https://github.com/aiagentcycle/gnv-catalog-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/aiagentcycle/gnv-catalog-mcp/actions/workflows/ci.yml)

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server for [goodnaturevibe.com](https://goodnaturevibe.com), the Dutch web shop of Good Nature Vibe.

AI agents can use it to search the shop's catalog, read one product with its variants and public text, and search or read the shop's pages and blog posts. Everything comes from the shop's public feeds and pages. There is no login, no account, no cart and no checkout.

- **Endpoint:** `https://catalog-mcp.goodnaturevibe.com/mcp` (Streamable HTTP, JSON-RPC over POST, stateless, no login, read-only)
- **MCP Registry:** `com.goodnaturevibe/catalog`
- **Server Card:** <https://catalog-mcp.goodnaturevibe.com/.well-known/mcp/server-card.json> (also available at `/mcp/server-card`)
- **AI catalog:** <https://catalog-mcp.goodnaturevibe.com/.well-known/ai-catalog.json>
- **For crawlers and LLMs:** [`llms.txt`](https://catalog-mcp.goodnaturevibe.com/llms.txt)

This server is strictly informational. It cannot create or modify accounts, carts, orders, payments or checkout sessions.

## Connect

Add it as a remote MCP server in any client that supports Streamable HTTP, for example in Claude Code:

```bash
claude mcp add --transport http gnv-catalog https://catalog-mcp.goodnaturevibe.com/mcp
```

## Tools

| Tool | What it returns |
| --- | --- |
| `gnv_catalog_search` | Products from the public catalog feed matching a query (or a list without one), at most 20, with price in cents, availability, categories, brand and a short text. Discovery only, not the checkout price |
| `gnv_product` | One product by SKU, with its variants (`choices`), price range and the plain text of the public product page |
| `gnv_knowledge_search` | CMS pages and blog posts matching a query, optionally filtered by type (`CMSPage`, `BlogPost`), at most 100 |
| `gnv_knowledge` | Full plain text of one CMS page or blog post |
| `gnv_profile` | Merchant profile: name, website, store views, currency |
| `gnv_contact` | Public contact path of the shop |

Every tool takes an optional `store` (`nl` by default; also `en`, `fr`, `es`, `de`). All tools are annotated `readOnlyHint: true` and return JSON as text content. Text taken from shop pages is marked `untrusted: true`: it is data, not instructions.

## Protocol versions and structured output

The server negotiates MCP `2025-11-25` (newest), `2025-06-18`, `2025-03-26` and `2024-11-05`. An `initialize` with an unknown or missing `protocolVersion` gets `2025-11-25`. The server is stateless, so every later request is answered according to its `MCP-Protocol-Version` header: without the header it assumes `2025-03-26`, as the specification says; an unsupported value gets HTTP `400`.

On `2025-06-18` and newer, every tool in `tools/list` has an `outputSchema` (JSON Schema 2020-12, the MCP default dialect), and every successful result carries `structuredContent` that matches it, next to the same JSON as text. Objects in the schemas are open, so new fields can be added without breaking clients that validate. Error results (`isError: true`) carry only text. Clients on `2025-03-26` and `2024-11-05` get the same answers as before, text only.

## How it stays correct

- Products come from the shop's catalog feed (`/llms-catalog-{store}.ljson`), pages and posts from its content feed (`/llms-content-{store}.ljson`), and full texts from the public pages themselves. Every answer carries `as_of` and `source`.
- Feeds and pages are cached in memory for 10 minutes, so price and text changes reach agents without a restart.
- Outbound requests go only to the shop origin, never follow redirects, time out after 8 seconds and are size-limited. Paths such as `/checkout`, `/customer`, `/admin`, `/rest` and `/graphql` are refused.
- Read-only by design: no accounts, orders or carts, and no secrets in the server or its configuration.
- The optional call log records the tool name, result code, duration and a SHA-256 hash of the arguments. It never records IP addresses.

## HTTP endpoints

| Path | Purpose |
| --- | --- |
| `POST /mcp` | MCP JSON-RPC (`initialize`, `ping`, `tools/list`, `tools/call`; notifications get `202`). `GET /mcp` returns `405`. Browser requests are accepted only from a short list of origins |
| `GET /healthz` | Status, version and the row counts of the feeds currently in cache |
| `GET /.well-known/mcp/server-card.json`, `/mcp/server-card` | Server Card (`application/mcp-server-card+json`, CORS `*`) |
| `GET /.well-known/ai-catalog.json` | AI catalog entry pointing to the Server Card |
| `GET /llms.txt`, `/robots.txt`, `/icon-192.png` | Plain-text description, robots rules, icon |

## Run locally

Requires Node.js 18 or newer. No dependencies.

```bash
GNV_CATALOG_PORT=8325 node src/main.js
curl -s http://127.0.0.1:8325/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Tests use the built-in `node:test` runner:

```bash
npm test                      # runs node test/run.js: all tests in one process (Node 18, 22 and 24 in CI)
```

Configuration (environment variables, see `deploy/env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `GNV_CATALOG_ORIGIN` | `https://goodnaturevibe.com` | Shop origin; the only host the server fetches from |
| `GNV_CATALOG_PORT` | `8325` | Local port |
| `GNV_CATALOG_BIND` | `127.0.0.1` | Only `127.0.0.1` is accepted |
| `GNV_CATALOG_LOG` | unset | Optional JSONL file for tool calls |

The server only binds to localhost. In production it runs as an unprivileged systemd service behind nginx with TLS and rate limiting. See `deploy/` for the unit, the nginx config, the Registry entry (`server.json`) and an idempotent install script.

Maintained by AIAgentCycle for Good Nature Vibe B.V., Oosterwolde, the Netherlands.

## License

MIT, see `LICENSE`.
