# Data cache with Workers Cache

This is a dependency-free Worker that demonstrates the core idea behind the
Next.js Data Cache without using KV.

- The default entrypoint represents the application and runs on every request.
- The `DataCache` entrypoint represents one cached data fetch.
- `Cache-Control: public, max-age=60` provides time-based revalidation.
- `Cache-Tag: blog` plus `POST /revalidate` provides on-demand tag invalidation.

Workers Cache sits in front of `DataCache.fetch()`. On a hit, Cloudflare returns
the stored API response without running `DataCache` or calling the upstream API.
The outer application still runs, so its `renderId` changes while
`dataFetchedAt` remains fixed.

```text
GET / -> application -> Workers Cache -> DataCache -> api.vercel.app/blog
                              | HIT
                              +----------> cached JSON
```

The important configuration is:

```jsonc
{
  "cache": { "enabled": true },
  "exports": {
    "default": { "type": "worker", "cache": { "enabled": false } },
    "DataCache": { "type": "worker", "cache": { "enabled": true } }
  }
}
```

Run locally with `npm run dev`, or deploy with `npm run deploy`. Workers Cache
itself runs at Cloudflare's edge, so deploy the Worker to observe real HIT/MISS
behavior. Request `/` twice to observe the same `dataFetchedAt`, then invalidate
it:

```sh
curl https://YOUR-WORKER.workers.dev/
curl https://YOUR-WORKER.workers.dev/
curl -X POST https://YOUR-WORKER.workers.dev/revalidate
curl https://YOUR-WORKER.workers.dev/
```

This intentionally omits Next.js-specific cache-key hashing, cache profiles,
and tag propagation. A production vinext adapter would map framework cache keys
to internal GET paths and map `revalidateTag()` to the same entrypoint-scoped
`ctx.cache.purge({ tags })` call shown here.

The revalidation route is intentionally unauthenticated for the demo. Protect
an equivalent production endpoint.

Workers Cache is not the lower-level `caches.default` Cache API. It provides
tiered caching and request collapsing, and cache hits skip the cached entrypoint
entirely.
