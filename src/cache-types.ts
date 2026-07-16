import type {
	CacheControlMetadata,
	CacheHandler,
	CacheHandlerValue,
	CachedAppPageValue,
	CachedFetchValue,
	CachedImageValue,
	CachedPagesValue,
	CachedRedirectValue,
	CachedRouteValue,
	IncrementalCacheValue,
} from 'vinext/shims/cache';

export type CacheRecord = {
	value: IncrementalCacheValue | null;
	tags: string[];
	lastModified: number;
	revalidateAt: number | null;
	expireAt: number | null;
	cacheControl?: CacheControlMetadata;
};

export type {
	CacheControlMetadata,
	CacheHandler,
	CacheHandlerValue,
	CachedAppPageValue,
	CachedFetchValue,
	CachedImageValue,
	CachedPagesValue,
	CachedRedirectValue,
	CachedRouteValue,
	IncrementalCacheValue,
};
