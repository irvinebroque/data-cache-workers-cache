# Workers Cache data-handler design

## Decision

Use Workers Cache as vinext's authoritative data cache. Use Cache API only as a
transient payload mailbox needed to turn `CacheHandler.set()` into the response
body of a cacheable `GET`.

This replaces the earlier request-header prototype. Values are never Base64
encoded into headers.

## Constraints

Workers Cache has the desired serving behavior:

- it caches a named entrypoint before Worker execution
- it is tiered and collapses concurrent requests
- it supports custom cache keys and per-entrypoint cache configuration
- it supports entrypoint-scoped global purges by `Cache-Tag`

It also imposes the central write constraint: only `GET` and `HEAD` responses
are cached. Custom RPC methods always execute, but their responses do not
populate Workers Cache.

Cache API can accept a streamed response body programmatically, but it is
data-center-local, does not participate in tiering, and is independent of
Workers Cache. Those properties make it unsuitable as the final store but useful
as a short-lived handoff between RPC and a cached loopback `GET`.

## Write protocol

1. `WorkersCacheHandler.set()` resolves vinext's effective revalidation,
   expiry, and tags.
2. It serializes the complete value into a versioned binary envelope. Large
   binary fields are raw frames rather than Base64 strings.
3. It calls `VinextDataCache.publish()` over RPC with a `Response` body stream,
   a random write ID, SHA-256 digest, and cache metadata.
4. `publish()` reads at most 2 MiB, verifies the declared length and digest, and
   stores the record in a named Cache API cache under a random UUID with a
   60-second TTL.
5. It invokes `VinextDataCache.fetch()` through `ctx.exports` using the stable
   custom cache key, the mailbox UUID, and `Cache-Control: no-cache`.
6. A cold request fills Workers Cache. A warm request revalidates inline and
   replaces the prior response without first purging it.
7. When `fetch()` executes, it streams the mailbox body into a cacheable `200`
   response with the physical TTL and hashed `Cache-Tag` values.
8. `publish()` verifies the fill response, then issues a second request without
   the mailbox UUID and only reports success if that cached response has the
   expected write ID and body digest.
9. If the nonce-free read does not return the expected write, `publish()` retries
   briefly and then fails without purging another writer's value.
10. The mailbox is deleted in `finally`; cleanup errors are logged without
    changing the result of a confirmed publication.

`WorkersCacheHandler.set()` also registers its publication promise with the
current request's `waitUntil()` and returns the same promise to callers that
await cache writes.

The only exception to nonce-free verification is explicitly enabled by the
interactive demo for requests with no Cloudflare `request.cf` metadata. The
vinext adapter does not expose that option and fails closed when a cache-status
header is absent.

The stable Workers Cache entry is therefore the only source used by normal
reads. The mailbox exists only during publication.

## Read protocol

`get(key)` hashes the app prefix and key into a custom Workers Cache key, then
performs a loopback `GET` to `VinextDataCache`.

- `HIT`: Workers Cache returns the envelope without executing the entrypoint.
- `MISS`: the entrypoint has no mailbox UUID and returns `404 no-store`.
- Corrupt body or digest mismatch: treat as a miss.
- Logical expiry: treat as a miss.
- Logical revalidation time elapsed: return the value with
  `cacheState: "stale"` so vinext can regenerate it.

Physical cache TTL is deliberately longer than logical revalidation. Expiring
the Workers Cache entry at the revalidation boundary would remove the stale
value vinext needs for stale-while-revalidate behavior.

## Value coverage

The envelope stores all current `vinext/shims/cache` variants:

| Kind | Representation |
|---|---|
| `FETCH` | JSON metadata; vinext body remains a string |
| `APP_PAGE` | JSON metadata plus raw `rscData` frame |
| `PAGES` | JSON metadata |
| `APP_ROUTE` | JSON metadata plus raw body frame |
| `REDIRECT` | JSON metadata |
| `IMAGE` | JSON metadata plus raw image frame |

It also stores `lastModified`, `revalidateAt`, `expireAt`, logical tags, and
effective `cacheControl` metadata.

## Invalidation

Workers Cache tag matching is case-insensitive and only accepts printable ASCII.
vinext tags are therefore mapped to app-scoped SHA-256 tags.

- exact key: `vx:k:<sha256>`
- hard tag: `vx:t:<sha256>`
- broad app data: `vx:data:<sha256>`

Hard `revalidateTag()` calls purge their mapped tags. Path-derived `_N_T_` tags
also purge the broad app tag because Workers Cache cannot discover every entry
that observed a soft tag at read time. This intentionally over-invalidates.
Purge calls are split into batches of at most 100 operations. Profile durations
currently use the same hard-invalidation path rather than tag-level stale-while-
revalidate; this is freshness-safe but loses the stale-serving optimization.
The handler accepts at most 232 logical tags so the hashed tags plus the key and
app tags fit Cloudflare's 16 KiB aggregate `Cache-Tag` header limit.

## Required deployment shape

- Export `VinextDataCache` from the Worker's top-level entry module.
- Enable Workers Cache for that named entrypoint.
- Keep the gateway/default entrypoint uncached unless it separately uses
  vinext's CDN cache adapter.
- Deploy the Worker on a custom domain so Cache API operations are functional.
- Disable `workers.dev` so an unsupported deployment cannot appear healthy.
- Register `src/workers-cache-handler.ts` as vinext's `cache.data` adapter.

## Known risks

The protocol is covered locally but its critical topology must be validated on
Cloudflare's deployed edge. In particular, the Cache API mailbox written by the
RPC invocation must be visible to the nested entrypoint execution that occurs on
a full Workers Cache miss. Service bindings run on the same thread/server by
default, but Workers Cache's tiered path makes this exact composition worth
testing directly.

Other accepted tradeoffs:

- explicit invalidations consume rate-limited Instant Purge capacity
- concurrent setters are not globally ordered
- another lower-tier cache may briefly observe an old value during propagation
- path invalidation purges the whole app data namespace
- records are capped at 2 MiB by this prototype
- Workers Cache remains ephemeral rather than durable storage

## Current evidence

Workers Vitest coverage proves the codec, bounded RPC transport, Cache API
mailbox handoff, nonce-free persistence-check logic, write/digest verification,
purge batching, request lifecycle registration, handler semantics, and demo
integration in workerd. It does not prove deployed Workers Cache because the
local runtime does not emulate that product.
