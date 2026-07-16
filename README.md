# vinext data cache on Workers Cache

This prototype implements vinext's complete `CacheHandler` interface with
**Workers Cache** as the authoritative store. Cloudflare's lower-level Cache API
is used only as a short-lived, data-center-local mailbox while publishing a
value; normal reads never use it.

Application code continues to use vinext and Next.js cache APIs:

```ts
const response = await fetch('https://api.example.com/posts', {
  next: { revalidate: 300, tags: ['posts'] },
});

revalidateTag('posts');
revalidatePath('/blog');
```

The handler supports fetch cache entries, `unstable_cache`, `"use cache"`, ISR
pages, route bodies, redirects, images, binary RSC data, logical stale/expiry
metadata, and tag invalidation.

## Why a mailbox exists

Workers Cache only stores responses from `GET` and `HEAD` invocations. A vinext
`set(key, value)` already has the value, but a cacheable `GET` cannot carry that
value in its body. Putting it in request headers is size-limited and requires
Base64 for binary data.

`VinextDataCache.publish()` bridges that gap without making Cache API the data
store:

```text
CacheHandler.set()
  -> binary record in an RPC Response stream
  -> Cache API mailbox under a random nonce
  -> no-cache loopback GET using the stable custom key
  -> VinextDataCache streams the mailbox body as its response
  -> Workers Cache stores or replaces that response
  -> nonce-free GET verifies the persisted write ID + SHA-256
  -> publish deletes the mailbox
```

The forced revalidation preserves the previous value until Cloudflare accepts
the replacement and avoids spending Instant Purge quota on normal writes. If
the persisted write cannot be verified, publication retries briefly and fails
without deleting another writer's value.

`CacheHandler.get()` only performs the stable cached `GET`:

```text
App Worker -> Workers Cache HIT -> binary vinext record
                          MISS -> VinextDataCache -> 404 no-store
```

No cached value is placed in request headers or query parameters.

## Binary format

Each cached response contains a versioned `VXWC` envelope:

- vinext's `lastModified`, `cacheControl`, stale time, expiry time, and tags
- JSON metadata for all `IncrementalCacheValue` variants
- raw frames for `APP_PAGE.rscData`, `APP_ROUTE.body`, and `IMAGE.buffer`
- a SHA-256 digest and random write ID for publication verification

The prototype caps an encoded record at 2 MiB. Both RPC input and cached reads
enforce the limit while streaming, before buffering the complete record.
Physical Workers Cache retention defaults to 30 days and is intentionally
separate from vinext's logical
revalidation time, allowing stale entries to remain available for regeneration.

## vinext setup

The Worker entry module must export `VinextDataCache` so the adapter can reach it
through `ctx.exports`:

```ts
// worker/index.ts
import handler from 'vinext/server/fetch-handler';
export { VinextDataCache } from '../src/data-cache';

export default handler;
```

Point vinext's data-cache slot at the runtime factory:

```ts
// vite.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vinext from 'vinext';

export default defineConfig({
  plugins: [
    vinext({
      cache: {
        data: {
          adapter: fileURLToPath(
            new URL('./src/workers-cache-handler.ts', import.meta.url),
          ),
          options: {
            appPrefix: 'my-app',
            storageTtlSeconds: 30 * 24 * 60 * 60,
          },
        },
      },
    }),
  ],
});
```

Enable Workers Cache only for the named cache entrypoint when the default
entrypoint should always execute:

```jsonc
{
  "main": "worker/index.ts",
  "workers_dev": false,
  "cache": {
    "enabled": true,
    "cross_version_cache": true
  },
  "exports": {
    "default": { "type": "worker", "cache": { "enabled": false } },
    "VinextDataCache": { "type": "worker", "cache": { "enabled": true } }
  },
  "routes": [
    { "pattern": "app.example.com", "custom_domain": true }
  ]
}
```

The custom domain is required. Cloudflare documents functional Cache API
operations for Workers deployed to custom domains; a `workers.dev`-only
deployment is not sufficient for the mailbox protocol. The repository config
sets `workers_dev` to `false` so a deployment cannot silently expose a broken
mailbox configuration. Add your own custom-domain route before deploying.

`cross_version_cache` is optional. It keeps data warm across deployments, while
the `/v1/` key namespace prevents incompatible protocol versions from sharing
entries.

## Invalidation

- Every entry receives a SHA-256 key tag for exact deletion.
- Hard vinext tags are SHA-256 encoded before becoming `Cache-Tag` values. This
  preserves case-sensitive vinext tags despite Cloudflare's case-insensitive tag
  matching and accepts tags that are not header-safe.
- Path-derived `_N_T_` soft tags cannot be reverse-indexed by Workers Cache. For
  correctness, path invalidation also purges an app-scoped `vx:data:*` tag,
  invalidating all data entries for that `appPrefix`.
- Purges originate from `VinextDataCache`, because Workers Cache purges are
  scoped to the entrypoint that owns the cached responses.
- Explicit invalidations are batched into at most 100 tags per purge request,
  matching Cloudflare's current purge operation limit.
- Entries accept at most 232 logical tags. With the two internal tags, the
  hashed `Cache-Tag` value remains within Cloudflare's 16 KiB aggregate limit;
  the final byte length is validated before publication.
- `revalidateTag()` profile durations currently use hard invalidation. This is
  freshness-safe but does not preserve stale entries for profile-based tag SWR.

## Run the demo

```sh
npm install
npm run dev
```

The local runtime exercises serialization, RPC, and the transient mailbox, but
does not emulate Workers Cache. The UI reports cache signals as unavailable
rather than presenting local execution as a real miss. Only the local demo path
explicitly permits a write without the nonce-free persistence proof. The vinext
adapter and deployed demo fail closed if `Cf-Cache-Status` is absent.

To exercise actual Workers Cache behavior, configure a custom domain and deploy:

```sh
npm run deploy
```

The public demo rate-limits all API requests and applies a stricter shared
per-location limit to delete/tag invalidation. For an internet-facing production
deployment, put mutation routes behind Cloudflare Access or Turnstile as well;
Workers Rate Limiting counters are intentionally permissive and location-local.

## Validation status

Automated tests currently cover:

- every vinext `IncrementalCacheValue` variant and raw binary frames
- logical revalidation and expiry metadata
- hard tags, broad path invalidation, and exact key deletion
- Cache API mailbox fill and digest verification
- bounded RPC, cached-response, and demo request bodies
- nonce-free persistence verification and purge batching
- fail-closed cache-status checks and the 16 KiB tag-header budget
- `waitUntil()` registration for cache publications
- the interactive API path using the real handler

Still requiring a deployed edge test:

- Cache API mailbox visibility during the nested Workers Cache miss
- cold fill and subsequent global/tiered `HIT`
- forced-revalidation overwrites and persistence across cache tiers
- concurrent writers and multi-colo reads
- the full 2 MiB record boundary

## Code layout

- `src/workers-cache-handler.ts`: vinext `CacheHandler` and adapter factory
- `src/cache-types.ts`: exact vinext cache types plus the stored envelope
- `src/cache-codec.ts`: binary envelope and SHA-256 verification
- `src/data-cache.ts`: mailbox publication and cache-owning entrypoint
- `src/cache-protocol.ts`: keys, tags, limits, and private protocol metadata
- `src/demo-api.ts`: session isolation, validation, and traces
- `src/demo-ui.ts`: dependency-free interactive UI

## Platform constraints

- Workers Cache is ephemeral and may evict entries before their physical TTL.
- Explicit purges are global, rate-limited, and not transactional with refill.
- Concurrent writes have no compare-and-swap or global ordering guarantee.
- Broad path invalidation favors correctness over cache retention.
- Cache API is independent of Workers Cache, local to a data center, and not
  tiered. This implementation uses it only for a random, 60-second mailbox and
  deletes the entry immediately after publication.
