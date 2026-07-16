# Runtime-style data cache with Workers Cache

This dependency-free prototype implements a Vercel Runtime Cache-shaped API on
top of **Workers Cache**, without KV and without the lower-level Cache API.

```ts
const cache = getCache(ctx.exports.DataCache);

await cache.set('blog', posts, {
  ttl: 3600,
  tags: ['blogs'],
});

const cached = await cache.get('blog');
await cache.delete('blog');
await cache.expireTag('blogs');
```

## Protocol

Workers Cache only stores responses from `GET` and `HEAD` calls, so the
caller-side facade translates key/value operations into internal `GET`s to the
cached `DataCache` entrypoint.

- `get(key)` calls `DataCache.fetch()` with a SHA-256 custom `cf.cacheKey`.
- `set(key, value)` sends JSON in a private Base64 request header.
- Request `Cache-Control: no-cache` forces a warm entry to revalidate.
- `DataCache` echoes the supplied value in a cacheable `200` response.
- A random write ID and the echoed body prevent a stale hit from being reported
  as a successful write.
- Every entry receives a hashed key tag, allowing `delete(key)` to purge it.
- `expireTag(tags)` calls `ctx.cache.purge()` from `DataCache`, because Workers
  Cache purges are scoped to the entrypoint that owns the cached response.

```text
get(key) ──GET/custom key──> Workers Cache ──HIT──> cached JSON
                                  │ MISS
                                  v
                              DataCache -> 404 no-store

set(key, value) ──GET + no-cache/custom key──> DataCache
                                                │
                                                └─200 + max-age + tags
                                                          │
                                                          v
                                                    Workers Cache
```

The default Worker uses the facade in the same pattern as Vercel's API:

```ts
let blog = await cache.get('blog');
if (blog === null) {
  blog = await fetch('https://api.vercel.app/blog').then((response) => response.json());
  await cache.set('blog', blog, { ttl: 60, tags: ['blog'] });
}
```

## Configuration

The application entrypoint must remain uncached while `DataCache` is cached:

```jsonc
{
  "cache": {
    "enabled": true,
    "cross_version_cache": true
  },
  "exports": {
    "default": { "type": "worker", "cache": { "enabled": false } },
    "DataCache": { "type": "worker", "cache": { "enabled": true } }
  }
}
```

Cross-version caching approximates Runtime Cache persistence across deploys.
The protocol version is included in every custom key so an incompatible change
can start with a new namespace.

## Run

```sh
npm run dev
npm run deploy
```

Workers Cache itself runs at Cloudflare's edge. Deploy before evaluating actual
HIT, overwrite, tiering, or purge behavior; the current local test runtime does
not emulate the edge cache.

```sh
curl https://YOUR-WORKER.workers.dev/
curl https://YOUR-WORKER.workers.dev/
curl -X POST https://YOUR-WORKER.workers.dev/revalidate
curl https://YOUR-WORKER.workers.dev/
```

## Prototype limits

- The 128 KB request-header limit leaves roughly 90 KB for a JSON value after
  Base64 encoding and metadata. Larger values need chunking plus a manifest.
- Values are JSON, and `null` is indistinguishable from a cache miss.
- Tags are printable ASCII, case-insensitive at purge time, and limited here to
  128 tags of 256 characters each.
- A two-phase `get()` then `set()` does not collapse application work on a cold
  miss. A read-through API computes inside `DataCache` when collapse matters.
- Writes are not atomic or globally ordered. A fill updates the traversed lower
  tier and upper tier; other lower tiers can retain an older fresh value.
- `delete()` and `expireTag()` use globally propagated but rate-limited purges.
- Cache entries are ephemeral and can be evicted before their freshness TTL.

The key behavior still requiring an edge integration test is that an internal
request carrying `Cache-Control: no-cache` executes `DataCache` for a warm key
and replaces it with the returned `200`. This follows RFC 9111 revalidation
semantics, but Cloudflare's Workers Cache documentation does not yet show this
exact key/value protocol.
