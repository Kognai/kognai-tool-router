# @kognai/tool-router

Kognai ToolRouter (KTR) turns a task written in plain words into a short, ranked list of tools an agent may use.

It keeps a catalog of tools built from MCP registries, OpenAPI documents, x402 resource lists and pay-skills
providers. It classifies the task and drops every tool the caller may not use (missing auth, risk class, payment
rules, tools nobody has reviewed), then ranks what is left with lexical, vector and capability scores. Every candidate it returns exists in the
catalog: it never makes a tool up.

- No runtime dependencies: Node 18 or later.
- No third-party code runs. It reads catalogs as data and never installs, launches or imports a tool.
- Results are data. A shortlist never authorises a payment, a post or a write by itself.

## Install

```sh
npm install @kognai/tool-router
```

## Use

```ts
import { MemoryCatalogStore, ingest, tagCapabilities, VERIFY_AUTHORITY, fromOpenApi, RouterIndex, route, readFlags, hashEmbeddingPort } from '@kognai/tool-router';

const store = new MemoryCatalogStore();
const provenance = { source: 'my-openapi', retrieved_at: new Date().toISOString(), licence: 'MIT', snapshot_sha256: '0'.repeat(64) };
ingest([fromOpenApi(openApiDocument, provenance)], store, { now: new Date().toISOString(), tagger: tagCapabilities });

// A tool from outside starts quarantined and is never offered until someone reviews it.
for (const r of store.latest()) store.setTrust(r.id, r.version, 'reviewed', VERIFY_AUTHORITY, 'reviewed by me');

const index = new RouterIndex(store, { vectorModel: hashEmbeddingPort.model });
const result = await route(
  { text: "What's the weather in Paris tomorrow?", context: { caller_id: 'my-agent', principal_id: 'me', kind: 'engine', business_tier: 'enterprise', connected: [], kognai_first: 'off' } },
  { store, index, flags: readFlags({}), offline: true, embed: hashEmbeddingPort },
);

console.log(result.requirement, result.shortlists); // 'tool', with the forecast operation in the shortlist
```

`offline: true` runs the router without the `TOOL_ROUTER_ENABLED` switch. Online, the router answers only when that
switch is on, and a stop flag always wins.

The bundled hash embedding works without a model. To use your own embedding model, pass an `EmbeddingPort`.

## Licence

MIT
