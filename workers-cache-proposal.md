# Workers Cache Runtime Cache Proposal

Your proposed mechanism is viable. My earlier answer was too categorical: Workers Cache can support a Vercel-like `get`/`set` facade, provided we accept cache semantics rather than storage semantics.

## Proposed API

```ts
const cache = getCache(ctx.exports.DataCache);

await cache.set("blog", posts, {
  ttl: 3600,
  tags: ["blogs"],
});

const cached = await cache.get<BlogPost[]>("blog");

await cache.delete("blog");
await cache.expireTag("blogs");
```

The public methods live in the caller. Internally, every operation targets the same cached `DataCache.fetch()` entrypoint.

## How It Works

### `get(key)`

The caller performs an internal cacheable `GET`:

```ts
DataCache.fetch("https://cache.internal/value", {
  cf: {
    cacheKey: hash(key),
  },
});
```

Cloudflare keys this using:

- The `DataCache` entrypoint
- The custom cache key
- `ctx.props`
- The Worker version, unless cross-version caching is enabled

On a hit, `DataCache` does not execute. The caller deserializes the cached response.

On a miss, `DataCache` returns `404` with `Cache-Control: no-store`, and `get()` returns `null`.

### `set(key, value, options)`

The caller issues a `GET` to the same entrypoint and custom key, carrying the serialized value and metadata in private request headers:

```ts
const writeId = crypto.randomUUID();

await DataCache.fetch(
  new Request("https://cache.internal/value", {
    headers: {
      "Cache-Control": "no-cache",
      "X-Cache-Operation": "set",
      "X-Cache-Value": encode(value),
      "X-Cache-Tags": options.tags.join(","),
      "X-Cache-Write-Id": writeId,
    },
  }),
  {
    cf: {
      cacheKey: hash(key),
      cacheControl: `public, max-age=${options.ttl}`,
    },
  },
);
```

`DataCache.fetch()` echoes the supplied value:

```ts
export class DataCache extends WorkerEntrypoint {
  async fetch(request: Request) {
    if (request.headers.get("X-Cache-Operation") !== "set") {
      return new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }

    return new Response(decodeValue(request), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Tag": readTags(request),
        "X-Cache-Write-Id": request.headers.get("X-Cache-Write-Id")!,
      },
    });
  }
}
```

The important detail is the request-side `Cache-Control: no-cache`. Workers Cache follows RFC 9111: `no-cache` requires revalidation rather than serving a fresh cached response blindly. `DataCache` then returns a new `200`, replacing the cached body. Meanwhile, `cf.cacheControl` controls the freshness policy of that replacement.

The write ID should be checked before `set()` resolves. If Cloudflare unexpectedly returned the previous cached value instead of executing the setter, the IDs would differ and `set()` would fail rather than falsely acknowledge the write.

This specific combination should be validated on a deployed Worker because the docs describe each behavior independently but do not provide this exact write-through example.

## Alternative Overwrite

The fully documented fallback is purge-then-fill:

1. Assign every entry an automatic tag derived from its key.
2. Call a custom RPC method on `DataCache` to purge that key tag.
3. Await successful purge acceptance.
4. Make a cacheable internal `GET` carrying the new value.
5. Verify the returned write ID.

This gives stronger global invalidation but has drawbacks:

- Purges are rate-limited.
- Purge and refill are not transactional.
- Readers can observe a miss between purge and refill.
- Concurrent setters have no defined ordering.

Current flexible purge limits range from 5 requests per minute on Free to 50 requests per second on Enterprise.

## Data Transport

The biggest practical constraint is getting the value into a cacheable `GET`.

| Transport | Practical result |
|---|---|
| Request header | Best option, approximately 90 KB after JSON/Base64 overhead |
| Query string | Approximately 16 KB maximum |
| `ctx.props` | Unsuitable because props become part of the cache key |
| `GET` body | Prohibited by the Request API |
| `POST`/RPC body | Can carry data, but the response cannot populate Workers Cache |

For values approaching Vercel's 2 MB limit, we could implement chunking:

1. Split the value into immutable chunks below the header limit.
2. Fill each chunk under a generation-specific key.
3. Publish a small manifest under the stable logical key.
4. Have `get()` read the manifest and retrieve its chunks.
5. Tag the manifest and chunks for invalidation.

That is technically feasible. Immutable generation keys make retries safe, and publishing the manifest last prevents partially written values from becoming visible. It adds substantial complexity and request overhead, however.

## Semantics

This could approximate Vercel Runtime Cache surprisingly closely:

| Capability | Support |
|---|---|
| `get(key)` | Yes |
| `set(key, value)` | Yes |
| `delete(key)` | Yes, through purge |
| `expireTag(tags)` | Yes |
| TTL | Yes |
| Tags | Yes |
| Ephemeral/LRU | Yes |
| Persistence across deploys | Optional cross-version caching |
| Small JSON values | Yes |
| 2 MB values | Only through chunking |
| Atomic writes/CAS | No |
| Globally ordered concurrent writes | No |

Workers Cache is tiered. A normal fill updates the lower tier traversed by the setter and the upper tier. Existing fresh copies in other lower-tier colos may remain until expiration. A global purge before filling is necessary if globally immediate replacement matters.

That is not necessarily disqualifying: Vercel Runtime Cache itself is regional and ephemeral.

## Important Tradeoff

A two-phase `get()` then `set()` API loses Workers Cache request collapsing on cold reads:

```ts
const value = await cache.get(key);

if (value === null) {
  const generated = await expensiveWork();
  await cache.set(key, generated);
}
```

The miss response is `no-store`, so many concurrent callers can all miss, perform the expensive work, and race to `set()`.

The current read-through example avoids that because the expensive operation occurs inside the cached entrypoint. Cloudflare collapses concurrent misses before invoking it.

Therefore, I would expose both APIs:

```ts
cache.get(key);
cache.set(key, value, options);
cache.delete(key);
cache.expireTag(tags);
```

And a preferred collapsing API:

```ts
cache.getOrCompute(key, loader, options);
```

Implementing arbitrary `getOrCompute` loaders for vinext requires framework support because a JavaScript callback cannot cross the cached `fetch()` boundary directly. But vinext controls function IDs, arguments, and dispatch, so it can create an internal compute route.

## Conclusion

A genuine Vercel-shaped Runtime Cache facade backed by Workers Cache is possible. The best initial implementation would support:

- JSON values under roughly 90 KB
- Request-side forced revalidation for `set()`
- Automatic per-key tags
- Tag expiration
- Write-ID verification
- Optional cross-version caching

Before presenting it as working, I would deploy a focused prototype and verify:

1. A warm entry is replaced by loopback `GET` with request `Cache-Control: no-cache`.
2. `cf.cacheControl` can simultaneously give the replacement a normal TTL.
3. The write ID confirms the setter executed.
4. Subsequent reads hit the new value from multiple colos.
5. Concurrent writes and purge-then-fill behavior are understood.

That prototype is worth building.
