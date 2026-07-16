import { WorkerEntrypoint } from 'cloudflare:workers';

const BLOG_API = 'https://api.vercel.app/blog';
const BLOG_KEY = 'blog';
const BLOG_TAG = 'blog';
const CACHE_URL = 'https://data-cache.internal/value';
const CACHE_KEY_PREFIX = '/__runtime-cache/v1/';
const DEFAULT_TTL_SECONDS = 3600;
const MAX_TAGS = 128;
const MAX_TAG_LENGTH = 256;
const MAX_REQUEST_HEADER_BYTES = 120 * 1024;

const OPERATION_HEADER = 'X-Data-Cache-Operation';
const VALUE_HEADER = 'X-Data-Cache-Value';
const TAGS_HEADER = 'X-Data-Cache-Tags';
const KEY_TAG_HEADER = 'X-Data-Cache-Key-Tag';
const TTL_HEADER = 'X-Data-Cache-Ttl';
const WRITE_ID_HEADER = 'X-Data-Cache-Write-Id';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type RuntimeCacheSetOptions = {
	ttl?: number;
	tags?: string[];
};

export type DataCacheStub = {
	fetch(input: string | Request, init?: RequestInit): Promise<Response>;
	purgeTags(tags: string[]): Promise<void>;
};

// Caller-side facade. All reads and writes become fetches to the same cached
// entrypoint, so they address the same Workers Cache namespace.
export function getCache(entrypoint: DataCacheStub) {
	return {
		async get<T extends JsonValue>(key: string): Promise<T | null> {
			const { cacheKey } = await cacheIdentity(key);
			const response = await entrypoint.fetch(CACHE_URL, { cf: { cacheKey } });

			if (response.status === 404) {
				await response.body?.cancel();
				return null;
			}

			const body = await response.text();
			if (!response.ok) {
				throw new Error(`Data cache read failed (${response.status}): ${body}`);
			}

			return JSON.parse(body) as T;
		},

		async set(key: string, value: JsonValue, options: RuntimeCacheSetOptions = {}): Promise<void> {
			const { cacheKey, keyTag } = await cacheIdentity(key);
			const ttl = validateTtl(options.ttl ?? DEFAULT_TTL_SECONDS);
			const tags = validateTags(options.tags ?? []);
			const serialized = JSON.stringify(value);
			const writeId = crypto.randomUUID();
			const headers = new Headers({
				// Force an existing fresh entry to revalidate so this request reaches
				// DataCache and its 200 response replaces the cached value.
				'Cache-Control': 'no-cache',
				[OPERATION_HEADER]: 'set',
				[VALUE_HEADER]: encodeBase64(serialized),
				[TAGS_HEADER]: tags.join(','),
				[KEY_TAG_HEADER]: keyTag,
				[TTL_HEADER]: String(ttl),
				[WRITE_ID_HEADER]: writeId,
			});

			assertHeaderBudget(headers);

			const response = await entrypoint.fetch(CACHE_URL, {
				headers,
				cf: { cacheKey },
			});
			const stored = await response.text();

			if (!response.ok) {
				throw new Error(`Data cache write failed (${response.status}): ${stored}`);
			}
			if (response.headers.get(WRITE_ID_HEADER) !== writeId || stored !== serialized) {
				throw new Error('Data cache write was not applied');
			}
		},

		async delete(key: string): Promise<void> {
			const { keyTag } = await cacheIdentity(key);
			await entrypoint.purgeTags([keyTag]);
		},

		async expireTag(tags: string | string[]): Promise<void> {
			await entrypoint.purgeTags(validateTags(Array.isArray(tags) ? tags : [tags]));
		},
	};
}

// Cache-owning entrypoint. A normal get only reaches this code on a miss. A set
// reaches it through request-side no-cache and returns the caller-provided value
// as the cacheable response.
export class DataCache extends WorkerEntrypoint<Env> {
	async fetch(request: Request): Promise<Response> {
		if (request.headers.get(OPERATION_HEADER) !== 'set') {
			return new Response(null, {
				status: 404,
				headers: { 'Cache-Control': 'no-store' },
			});
		}

		try {
			const encodedValue = requiredHeader(request, VALUE_HEADER);
			const keyTag = validateTags([requiredHeader(request, KEY_TAG_HEADER)])[0];
			const tagsHeader = request.headers.get(TAGS_HEADER);
			const tags = validateTags(tagsHeader ? tagsHeader.split(',') : [], MAX_TAGS + 1);
			const ttl = validateTtl(Number(requiredHeader(request, TTL_HEADER)));
			const writeId = requiredHeader(request, WRITE_ID_HEADER);

			return new Response(decodeBase64(encodedValue), {
				headers: {
					'Cache-Control': `public, max-age=${ttl}, stale-if-error=0`,
					'Cache-Tag': [...tags, keyTag].join(','),
					'Content-Type': 'application/json',
					[WRITE_ID_HEADER]: writeId,
				},
			});
		} catch (error) {
			return Response.json(
				{ error: error instanceof Error ? error.message : String(error) },
				{ status: 400, headers: { 'Cache-Control': 'no-store' } },
			);
		}
	}

	async purgeTags(tags: string[]): Promise<void> {
		if (!this.ctx.cache) {
			throw new Error('Workers Cache is not enabled for DataCache');
		}

		const result = await this.ctx.cache.purge({ tags: validateTags(tags, MAX_TAGS + 1) });
		if (!result.success) {
			throw new Error(`Data cache purge failed: ${result.errors.map((error) => error.message).join(', ')}`);
		}
	}
}

export default {
	async fetch(request, _env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const cache = getCache(ctx.exports.DataCache);

		if (request.method === 'POST' && url.pathname === '/revalidate') {
			await cache.expireTag(BLOG_TAG);
			return Response.json({ revalidated: true, tag: BLOG_TAG });
		}

		if (request.method !== 'GET' || url.pathname !== '/') {
			return new Response('Not found', { status: 404 });
		}

		type CachedBlog = { fetchedAt: string; posts: JsonValue };
		let blog = await cache.get<CachedBlog>(BLOG_KEY);
		let dataCache = 'hit';

		if (blog === null) {
			dataCache = 'miss';
			const upstream = await fetch(BLOG_API);
			if (!upstream.ok) {
				return new Response(upstream.body, {
					status: upstream.status,
					headers: { 'Cache-Control': 'no-store' },
				});
			}

			blog = {
				fetchedAt: new Date().toISOString(),
				posts: await upstream.json<JsonValue>(),
			};
			await cache.set(BLOG_KEY, blog, { ttl: 60, tags: [BLOG_TAG] });
		}

		return Response.json(
			{
				renderId: crypto.randomUUID(),
				renderedAt: new Date().toISOString(),
				dataCache,
				dataFetchedAt: blog.fetchedAt,
				data: blog.posts,
			},
			{ headers: { 'Cache-Control': 'no-store' } },
		);
	},
} satisfies ExportedHandler<Env>;

async function cacheIdentity(key: string): Promise<{ cacheKey: string; keyTag: string }> {
	if (!key) throw new TypeError('Data cache key must not be empty');

	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
	const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return {
		cacheKey: `${CACHE_KEY_PREFIX}${hash}`,
		keyTag: `__key:${hash}`,
	};
}

function validateTtl(ttl: number): number {
	if (!Number.isSafeInteger(ttl) || ttl <= 0) {
		throw new TypeError('Data cache ttl must be a positive integer');
	}
	return ttl;
}

function validateTags(tags: string[], maximum = MAX_TAGS): string[] {
	if (tags.length > maximum) throw new TypeError(`Data cache accepts at most ${maximum} tags`);

	const unique = [...new Set(tags)];
	for (const tag of unique) {
		if (!tag || tag.length > MAX_TAG_LENGTH || tag.includes(',') || !/^[!-~]+$/.test(tag)) {
			throw new TypeError(`Invalid data cache tag: ${tag}`);
		}
	}
	return unique;
}

function requiredHeader(request: Request, name: string): string {
	const value = request.headers.get(name);
	if (!value) throw new TypeError(`Missing ${name} header`);
	return value;
}

function assertHeaderBudget(headers: Headers): void {
	let size = 0;
	headers.forEach((value, name) => {
		size += new TextEncoder().encode(`${name}: ${value}\r\n`).byteLength;
	});
	if (size > MAX_REQUEST_HEADER_BYTES) {
		throw new RangeError('Serialized data cache value is too large for the prototype');
	}
}

function encodeBase64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
	const binary = atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
