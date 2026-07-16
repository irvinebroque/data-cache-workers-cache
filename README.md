# vinext data cache on Workers Cache

This adapter lets vinext use [Cloudflare Workers Cache](https://developers.cloudflare.com/workers/cache/) as its shared server-side cache.

Your application keeps using the normal Next.js caching APIs. It does not need to know how Cloudflare stores the values.

```ts
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache';

const response = await fetch('https://api.example.com/posts', {
  next: { revalidate: 300, tags: ['posts'] },
});

const getSettings = unstable_cache(loadSettings, ['settings'], {
  revalidate: 300,
  tags: ['settings'],
});

revalidateTag('posts');
revalidatePath('/blog');
```

vinext calls this adapter behind those APIs. The adapter implements vinext's complete `CacheHandler` interface.

It supports:

- cached `fetch`, `unstable_cache`, and `"use cache"`
- ISR pages from the App Router and Pages Router
- route responses, redirects, images, and binary RSC data
- stale and expiry times
- exact-key deletion, tag invalidation, and path invalidation

## Before you start

This repository is a prototype, not a published npm package. The setup below assumes these adapter files live in your application under `src/`.

You also need:

- vinext running on Cloudflare Workers
- Wrangler 4.107.0 or newer
- a custom domain in an active Cloudflare zone

> **A custom domain is required.** A `workers.dev` deployment is not enough. The write protocol uses the Cache API as a temporary mailbox, and Cloudflare only provides functional Cache API operations for Workers on custom domains.

## Setup

### 1. Export the cache entrypoint

Export `VinextDataCache` from the same top-level Worker module as your vinext application:

```ts
// src/index.ts
import handler from 'vinext/server/fetch-handler';

export { VinextDataCache } from './data-cache';
export default handler;
```

The name must be exactly `VinextDataCache`. The adapter finds this entrypoint through `ctx.exports`.

### 2. Register the vinext adapter

Point vinext's `cache.data` setting at `src/workers-cache-handler.ts`:

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

The adapter has two configuration options:

| Option | Default | Meaning |
| --- | --- | --- |
| `appPrefix` | `""` | A stable name used to separate one app's keys and tags from another app's. Use a unique value when several apps share the same Worker cache. |
| `storageTtlSeconds` | 30 days | How long Cloudflare may physically retain a record. This is separate from Next.js `revalidate` and `expire` times. |

### 3. Configure Workers Cache

Keep the default application entrypoint uncached. This ensures that your application still runs for every request. Enable Workers Cache only for the named `VinextDataCache` entrypoint.

```jsonc
// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-vinext-app",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-15",
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

Replace `app.example.com` with your hostname. `workers_dev: false` prevents an unsupported `workers.dev` deployment from appearing to work.

`cross_version_cache` is optional. When enabled, cached records can survive deployments. The record format includes its own version so incompatible records are not reused.

After changing bindings or exports, regenerate the Worker types:

```sh
npx wrangler types
```

### 4. Deploy

```sh
npm run deploy
```

Wrangler should list your custom-domain route. A Preview URL or `workers.dev` URL does not prove that writes work.

## How it works

Two Cloudflare cache features are involved:

| Feature | Job |
| --- | --- |
| **Workers Cache** | The real store. Normal reads use only this cache. It is tiered and sits in front of the `VinextDataCache` entrypoint. |
| **Cache API** | A temporary, data-center-local mailbox used only while writing a value. It is not the backing store. |

### Reads

The adapter hashes the app prefix and vinext key into a stable cache key. It then sends a loopback `GET` to `VinextDataCache`.

```text
CacheHandler.get(key)
  -> GET VinextDataCache with the stable key
     -> HIT: Workers Cache returns the stored record
             VinextDataCache does not run
     -> MISS: VinextDataCache runs and returns 404 no-store
```

On a hit, the adapter verifies the record's SHA-256 digest before decoding it. A corrupt or expired record becomes a miss. A stale record is returned as stale so vinext can regenerate it.

Normal reads never open or inspect the temporary mailbox.

### Writes

Workers Cache only stores responses from `GET` and `HEAD` requests. However, `CacheHandler.set()` already has a value that it needs to send somewhere. A cacheable `GET` cannot carry that value in its request body, and a custom RPC response is not stored by Workers Cache.

The temporary mailbox connects those two operations:

```text
CacheHandler.set(key, value)
  -> encode the complete vinext value
  -> RPC VinextDataCache.publish(record)
  -> put the record in a random Cache API mailbox
  -> send a no-cache GET using the stable key and mailbox ID
  -> VinextDataCache streams the mailbox record in its response
  -> Workers Cache stores or replaces that response
  -> send another GET without the mailbox ID
  -> verify that Workers Cache returns the new write ID and digest
  -> delete the mailbox entry
```

`Cache-Control: no-cache` forces Cloudflare to revalidate a warm entry. It does not bypass Workers Cache. This replaces an existing value without purging it first.

The second `GET` is important. Without the mailbox ID, `VinextDataCache` can only produce a `404`. Receiving the expected record proves that Workers Cache stored the write. If verification fails, the adapter retries briefly and then reports an error.

Normal writes do not purge. Only explicit deletion or tag/path invalidation uses Cloudflare's purge API.

### Invalidation

Every record gets a hashed key tag for exact deletion. vinext tags are also hashed before they become Cloudflare `Cache-Tag` values. Hashing preserves vinext's case-sensitive tags and safely handles spaces or Unicode.

`revalidatePath()` is broader. Workers Cache cannot look up every record that observed a path tag, so path invalidation may purge every data-cache record under the same `appPrefix`. This favors correct results over keeping unrelated entries warm.

Purge calls run from `VinextDataCache` because Workers Cache purges are scoped to the entrypoint that owns the cached response.

### Stored records and time-to-live

Each value is stored in a versioned `VXWC` binary record. JSON-like fields stay as metadata. Large binary fields, such as RSC data, route bodies, and images, stay as raw binary frames instead of Base64 strings.

Logical and physical lifetimes are separate:

- `revalidate` marks a value stale so vinext can regenerate it.
- `expire` makes future reads miss after the expiry time.
- `storageTtlSeconds` controls physical retention in Workers Cache.

The physical TTL defaults to 30 days and is never shorter than the logical expiry time. A long physical TTL keeps stale values available for regeneration, but it does not make Workers Cache durable. Cloudflare may evict values sooner.

## Limits and trade-offs

| Constraint | Current behavior |
| --- | --- |
| Record size | At most 2 MiB for the complete encoded value. |
| Tags | At most 232 logical tags per record, within Cloudflare's 16 KiB aggregate `Cache-Tag` limit. |
| Purges | Split into batches of at most 100 tags. Account purge rate limits still apply. |
| Tag profiles | `revalidateTag()` profile durations currently cause immediate hard invalidation instead of tag-level stale-while-revalidate. |
| Path invalidation | May purge the full `appPrefix` data namespace. |
| Durability | Workers Cache is temporary and may evict records before their TTL. |
| Concurrent writes | There is no compare-and-swap operation or global write ordering. Different locations can briefly see different values. |

## Local development

```sh
npm install
npm run dev
```

The local demo exercises the codec, RPC calls, mailbox, and API. Local workerd does **not** emulate Workers Cache, tiered hits, global purge, or overwrite behavior. The demo therefore shows cache status as **Unavailable**, not as a real miss.

Real cache behavior requires a deployment on the configured custom domain.

## Verification

Run the local checks:

```sh
npm test -- --run
npx tsc --noEmit
npx wrangler deploy --dry-run
```

The automated tests cover all vinext value types, binary frames, stale and expiry metadata, mailbox transport, digest checks, invalidation, purge batching, size limits, request lifecycle handling, and the demo API.

After deploying, verify the edge behavior:

1. Read a new key. The first request should fetch and store the value.
2. Read the same key again. It should report `HIT`, and `VinextDataCache` should be skipped.
3. Overwrite the key. The next read should return the new value without a purge.
4. Invalidate the key or tag. A later read should miss and refill after purge propagation.

The deployed edge still needs broader testing for concurrent writers, reads from several Cloudflare locations, cache-tier replacement, and the full 2 MiB boundary.

## Main files

- `src/workers-cache-handler.ts`: vinext `CacheHandler` and adapter factory
- `src/data-cache.ts`: cache-owning entrypoint and mailbox publication
- `src/cache-codec.ts`: versioned binary format and digest verification
- `src/cache-protocol.ts`: keys, tags, headers, and limits
- `workers-cache-proposal.md`: deeper design notes and trade-offs

Cloudflare references:

- [Workers Cache](https://developers.cloudflare.com/workers/cache/)
- [Workers Cache configuration](https://developers.cloudflare.com/workers/cache/configuration/)
- [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Workers Cache purging](https://developers.cloudflare.com/workers/cache/purge/)
