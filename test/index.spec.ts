import { createExecutionContext } from 'cloudflare:test';
import { env, exports as workerExports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheRecordDigest, decodeCacheRecord, encodeCacheRecord } from '../src/cache-codec';
import {
	cacheIdentity,
	cacheNamespaceTag,
	cacheTag,
	CACHE_URL,
	DIGEST_HEADER,
	EXECUTED_AT_HEADER,
	EXECUTION_ID_HEADER,
	MAILBOX_CACHE_NAME,
	MAILBOX_HEADER,
	mailboxRequest,
	MAX_RECORD_BYTES,
	TAGS_HEADER,
	TTL_HEADER,
	validateCacheHeaderTags,
	validateTags,
	WRITE_ID_HEADER,
} from '../src/cache-protocol';
import type { CacheRecord, IncrementalCacheValue } from '../src/cache-types';
import { VinextDataCache, type CachePublishInput, type CachePublishResult } from '../src/data-cache';
import { handleDemoApi } from '../src/demo-api';
import {
	WorkersCacheHandler,
	type VinextDataCacheStub,
	type WorkersCacheTrace,
} from '../src/workers-cache-handler';
import { runWithExecutionContext } from 'vinext/shims/request-context';

describe('vinext Workers Cache handler', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('round-trips every vinext cache value through the binary codec', () => {
		const values: Array<IncrementalCacheValue | null> = [
			null,
			fetchValue({ message: 'hello' }, ['posts'], 60),
			{
				kind: 'APP_PAGE',
				html: '<main>page</main>',
				rscData: bytes(1, 2, 3),
				headers: { vary: ['RSC', 'Accept'] },
				postponed: undefined,
				status: 200,
			},
			{
				kind: 'PAGES',
				html: '<main>pages</main>',
				pageData: { slug: 'post' },
				headers: { 'content-type': 'text/html' },
				status: 200,
			},
			{
				kind: 'APP_ROUTE',
				body: bytes(4, 5, 6),
				status: 201,
				headers: { 'content-type': 'application/octet-stream' },
			},
			{ kind: 'REDIRECT', props: { destination: '/new', permanent: false } },
			{ kind: 'IMAGE', etag: 'image-etag', buffer: bytes(7, 8, 9), extension: 'png', revalidate: 300 },
		];

		for (const value of values) {
			const record = cacheRecord(value);
			const decoded = decodeCacheRecord(encodeCacheRecord(record));
			expect(normalize(decoded)).toEqual(normalize(record));
		}
	});

	it('rejects corrupted binary records', async () => {
		const encoded = new Uint8Array(encodeCacheRecord(cacheRecord(fetchValue('safe'))));
		const digest = await cacheRecordDigest(encoded.buffer);
		encoded[encoded.length - 1] ^= 0xff;

		expect(await cacheRecordDigest(encoded.buffer)).not.toBe(digest);
		expect(() => decodeCacheRecord(encoded.buffer)).toThrow();
	});

	it('rejects oversized metadata before constructing the encoded envelope', () => {
		const value: IncrementalCacheValue = {
			kind: 'FETCH',
			data: { headers: {}, body: 'x'.repeat(MAX_RECORD_BYTES), url: 'https://example.com' },
			revalidate: 60,
		};
		expect(() => encodeCacheRecord(cacheRecord(value))).toThrow(`exceeds ${MAX_RECORD_BYTES} bytes`);
	});

	it('treats an oversized cached response as a miss without buffering it', async () => {
		const stub = new MemoryDataCacheStub();
		const cache = new WorkersCacheHandler(stub);
		const { cacheKey } = await cacheIdentity('oversized-cache-hit');
		stub.entries.set(cacheKey, {
			response: new Response(new Uint8Array(MAX_RECORD_BYTES + 1), {
				headers: { [DIGEST_HEADER]: '0'.repeat(64) },
			}),
			tags: [],
		});
		const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(await cache.get('oversized-cache-hit')).toBeNull();
		expect(logError).toHaveBeenCalledOnce();
	});

	it('implements get, set, overwrite, expiry, and stale metadata', async () => {
		const stub = new MemoryDataCacheStub();
		const traces: WorkersCacheTrace[] = [];
		let now = 1_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const cache = new WorkersCacheHandler(stub, {
			appPrefix: 'test',
			storageTtlSeconds: 3600,
			onTrace: (trace) => traces.push(trace),
		});

		expect(await cache.get('greeting')).toBeNull();
		await cache.set('greeting', fetchValue({ revision: 1 }, ['messages'], 60), {
			tags: ['messages'],
			revalidate: 60,
			expire: 120,
		});
		expect(readFetchValue(await cache.get('greeting'))).toEqual({ revision: 1 });

		now += 61_000;
		expect((await cache.get('greeting'))?.cacheState).toBe('stale');
		await cache.set('greeting', fetchValue({ revision: 2 }, ['messages'], 120), {
			tags: ['messages'],
			revalidate: 120,
		});
		expect(readFetchValue(await cache.get('greeting'))).toEqual({ revision: 2 });

		now += 121_000;
		expect((await cache.get('greeting'))?.cacheState).toBe('stale');
		expect(traces.map((trace) => trace.outcome)).toEqual(['miss', 'stored', 'hit', 'hit', 'stored', 'hit', 'hit']);
		expect(stub.lastPublish?.byteLength).toBeGreaterThan(0);
		expect(stub.lastPublish?.physicalTtl).toBe(3600);
	});

	it('maps hard tags, path tags, and deletes to entrypoint-scoped purges', async () => {
		const stub = new MemoryDataCacheStub();
		const cache = new WorkersCacheHandler(stub, { appPrefix: 'site' });

		await cache.revalidateTag(['blog', 'posts']);
		expect(stub.purgeCalls[0]).toEqual([
			await cacheTag('blog', 'site'),
			await cacheTag('posts', 'site'),
		]);

		await cache.revalidateTag('_N_T_/blog');
		expect(stub.purgeCalls[1]).toEqual([
			await cacheTag('_N_T_/blog', 'site'),
			await cacheNamespaceTag('site'),
		]);

		await cache.delete('post:1');
		expect(stub.purgeCalls[2]).toEqual([(await cacheIdentity('post:1', 'site')).keyTag]);
		expect(validateTags(Array.from({ length: 233 }, () => 'duplicate'))).toEqual(['duplicate']);
		expect(() =>
			validateCacheHeaderTags(Array.from({ length: 234 }, (_, index) => `${String(index).padStart(4, '0')}${'x'.repeat(66)}`)),
		).toThrow('Cache-Tag header exceeds 16384 bytes');
	});

	it('registers cache publication with the request execution context', async () => {
		const waitUntil = vi.fn((_promise: Promise<unknown>) => undefined);
		const cache = new WorkersCacheHandler(new MemoryDataCacheStub());

		await runWithExecutionContext({ waitUntil }, async () => {
			const publication = cache.set('background-write', fetchValue('value'));
			expect(waitUntil).toHaveBeenCalledWith(publication);
			await publication;
		});
	});

	it('turns a Cache API mailbox response into a cacheable binary GET', async () => {
		const nonce = crypto.randomUUID();
		const writeId = crypto.randomUUID();
		const encoded = encodeCacheRecord(cacheRecord(fetchValue({ cached: true })));
		const digest = await cacheRecordDigest(encoded);
		const mailbox = await caches.open(MAILBOX_CACHE_NAME);
		const request = mailboxRequest(nonce);
		await mailbox.put(
			request,
			new Response(encoded, {
				headers: {
					'Cache-Control': 'public, max-age=60',
					[TAGS_HEADER]: 'vx:k:abc,vx:data:abc',
					[TTL_HEADER]: '300',
					[WRITE_ID_HEADER]: writeId,
					[DIGEST_HEADER]: digest,
				},
			}),
		);

		try {
			const response = await new VinextDataCache(createExecutionContext(), env).fetch(
				new Request(CACHE_URL, { headers: { [MAILBOX_HEADER]: nonce } }),
			);
			expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, stale-if-error=0');
			expect(response.headers.get('Cache-Tag')).toBe('vx:k:abc,vx:data:abc');
			expect(response.headers.get(WRITE_ID_HEADER)).toBe(writeId);
			expect(response.headers.get(DIGEST_HEADER)).toBe(digest);
			expect(response.headers.get(EXECUTION_ID_HEADER)).toBeTypeOf('string');
			expect(decodeCacheRecord(await response.arrayBuffer()).value?.kind).toBe('FETCH');
		} finally {
			await mailbox.delete(request);
		}
	});

	it('publishes through the transient mailbox in local workerd', async () => {
		const ctx = createExecutionContext();
		const entrypoint = new VinextDataCache(ctx, env);
		const key = 'mailbox-roundtrip';
		const appPrefix = 'test';
		const { keyTag } = await cacheIdentity(key, appPrefix);
		const encoded = encodeCacheRecord(cacheRecord(fetchValue('mailbox')));
		const digest = await cacheRecordDigest(encoded);
		const input: CachePublishInput = {
			key,
			appPrefix,
			cacheTags: [keyTag, await cacheNamespaceTag(appPrefix)],
			physicalTtl: 300,
			writeId: crypto.randomUUID(),
			digest,
			byteLength: encoded.byteLength,
			allowUnverifiedLocal: true,
		};

		const result = await entrypoint.publish(new Response(encoded), input);
		expect(result.writeId).toBe(input.writeId);
		expect(result.digest).toBe(digest);
		expect(result.attempts).toBe(1);
		expect(result.cacheStatus).toBeUndefined();
	});

	it('rejects a missing cache-status header unless local writes are explicitly enabled', async () => {
		const ctx = createExecutionContext();
		const key = 'misconfigured-cache';
		const appPrefix = 'test';
		const { keyTag } = await cacheIdentity(key, appPrefix);
		const encoded = encodeCacheRecord(cacheRecord(fetchValue('not-persisted')));
		const digest = await cacheRecordDigest(encoded);
		const input: CachePublishInput = {
			key,
			appPrefix,
			cacheTags: [keyTag],
			physicalTtl: 300,
			writeId: crypto.randomUUID(),
			digest,
			byteLength: encoded.byteLength,
		};
		const fetch = vi.fn(async () =>
			new Response(encoded.slice(0), {
				headers: { [WRITE_ID_HEADER]: input.writeId, [DIGEST_HEADER]: digest },
			}),
		);
		Object.defineProperty(ctx, 'exports', { value: { VinextDataCache: { fetch } } });

		await expect(new VinextDataCache(ctx, env).publish(new Response(encoded), input)).rejects.toThrow(
			'Workers Cache fill did not return Cf-Cache-Status',
		);
	});

	it('verifies a nonce-free Workers Cache read before reporting edge publication success', async () => {
		const ctx = createExecutionContext();
		const purge = vi.fn(async () => ({ success: true, errors: [] }));
		Object.defineProperty(ctx, 'cache', { value: { purge } });
		const key = 'persisted-roundtrip';
		const appPrefix = 'test';
		const { keyTag } = await cacheIdentity(key, appPrefix);
		const encoded = encodeCacheRecord(cacheRecord(fetchValue('persisted')));
		const digest = await cacheRecordDigest(encoded);
		const input: CachePublishInput = {
			key,
			appPrefix,
			cacheTags: [keyTag, await cacheNamespaceTag(appPrefix)],
			physicalTtl: 300,
			writeId: crypto.randomUUID(),
			digest,
			byteLength: encoded.byteLength,
		};
		const fetch = vi.fn(async (_url: string | Request, init?: RequestInit) => {
			const filling = new Headers(init?.headers).has(MAILBOX_HEADER);
			return new Response(encoded.slice(0), {
				headers: {
					'Cf-Cache-Status': filling ? 'MISS' : 'HIT',
					[WRITE_ID_HEADER]: input.writeId,
					[DIGEST_HEADER]: input.digest,
				},
			});
		});
		Object.defineProperty(ctx, 'exports', { value: { VinextDataCache: { fetch } } });

		const result = await new VinextDataCache(ctx, env).publish(new Response(encoded), input);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has(MAILBOX_HEADER)).toBe(true);
		expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).has(MAILBOX_HEADER)).toBe(false);
		expect(result.cacheStatus).toBe('HIT');
		expect(purge).not.toHaveBeenCalled();
	});

	it('bounds RPC bodies and batches purge operations', async () => {
		const ctx = createExecutionContext();
		const purge = vi.fn(async (_input: { tags: string[] }) => ({ success: true, errors: [] }));
		Object.defineProperty(ctx, 'cache', { value: { purge } });
		const entrypoint = new VinextDataCache(ctx, env);
		const key = 'oversized';
		const appPrefix = 'test';
		const { keyTag } = await cacheIdentity(key, appPrefix);
		const input: CachePublishInput = {
			key,
			appPrefix,
			cacheTags: [keyTag],
			physicalTtl: 300,
			writeId: crypto.randomUUID(),
			digest: '0'.repeat(64),
			byteLength: 1,
		};

		await expect(entrypoint.publish(new Response(new Uint8Array(MAX_RECORD_BYTES + 1)), input)).rejects.toThrow(
			`exceeds ${MAX_RECORD_BYTES} bytes`,
		);

		const tags = Array.from({ length: 128 }, (_, index) => `vx:t:${index}`);
		await entrypoint.purgeTags(tags);
		expect(purge).toHaveBeenCalledTimes(2);
		expect(purge.mock.calls[0]?.[0].tags).toHaveLength(100);
		expect(purge.mock.calls[1]?.[0].tags).toHaveLength(28);
	});

	it('rejects an oversized chunked demo request before execution', async () => {
		const execute = vi.fn(async () => ({ source: 'origin' as const, value: null }));
		let cancelled = false;
		const request = new Request('https://example.com/api/demo/read-through', {
			method: 'POST',
			body: new ReadableStream({
				pull(controller) {
					controller.enqueue(new Uint8Array(64 * 1024));
				},
				cancel() {
					cancelled = true;
				},
			}),
		});

		const response = await handleDemoApi(request, new MemoryDataCacheStub(), 'read-through', execute);
		expect(response.status).toBe(400);
		expect(execute).not.toHaveBeenCalled();
		expect(cancelled).toBe(true);
	});

	it('serves the interactive vinext handler UI', async () => {
		const response = await workerExports.default.fetch('https://example.com/');
		const html = await response.text();

		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(response.headers.get('Content-Type')).toContain('text/html');
		expect(html).toContain('vinext CacheHandler on Workers Cache');
		expect(html).toContain('src/index.ts');
	});

	it('executes a read-through miss through the real handler', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const request = new Request(input, init);
			if (request.method === 'GET' && request.url === 'https://api.vercel.app/blog') {
				return Response.json([{ title: 'prototype' }]);
			}
			throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
		});

		const response = await workerExports.default.fetch('https://example.com/api/demo/read-through', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId: 'test-session', key: 'blog', ttl: 60, tags: ['blog'] }),
		});
		const body = await response.json<{ source: string; value: unknown; traces: WorkersCacheTrace[] }>();

		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(response.status, JSON.stringify(body)).toBe(200);
		expect(body.source).toBe('origin');
		expect(body.value).toEqual([{ title: 'prototype' }]);
		expect(body.traces.map((trace) => trace.operation)).toEqual(['get', 'set']);
		expect(body.traces.map((trace) => trace.outcome)).toEqual(['miss', 'stored']);
	});
});

class MemoryDataCacheStub implements VinextDataCacheStub {
	readonly entries = new Map<string, { response: Response; tags: string[] }>();
	readonly purgeCalls: string[][] = [];
	lastPublish?: CachePublishInput;

	async fetch(_input: string | Request, init?: RequestInit): Promise<Response> {
		const cacheKey = init?.cf?.cacheKey;
		if (typeof cacheKey !== 'string' || !cacheKey) throw new Error('Missing custom cache key');
		const entry = this.entries.get(cacheKey);
		if (!entry) {
			return new Response(null, {
				status: 404,
				headers: {
					'Cache-Control': 'no-store',
					[EXECUTION_ID_HEADER]: crypto.randomUUID(),
					[EXECUTED_AT_HEADER]: new Date().toISOString(),
				},
			});
		}
		const response = entry.response.clone();
		const headers = new Headers(response.headers);
		headers.set('Cf-Cache-Status', 'HIT');
		return new Response(response.body, { status: response.status, headers });
	}

	async publish(record: Response, input: CachePublishInput): Promise<CachePublishResult> {
		this.lastPublish = input;
		const encoded = await record.arrayBuffer();
		const { cacheKey } = await cacheIdentity(input.key, input.appPrefix);
		this.entries.set(cacheKey, {
			response: new Response(encoded, {
				headers: {
					'Cache-Control': `public, max-age=${input.physicalTtl}, stale-if-error=0`,
					[WRITE_ID_HEADER]: input.writeId,
					[DIGEST_HEADER]: input.digest,
					[EXECUTION_ID_HEADER]: crypto.randomUUID(),
					[EXECUTED_AT_HEADER]: new Date().toISOString(),
				},
			}),
			tags: input.cacheTags,
		});
		return {
			writeId: input.writeId,
			digest: input.digest,
			httpStatus: 200,
			attempts: 1,
		};
	}

	async purgeTags(tags: string[]): Promise<void> {
		this.purgeCalls.push(tags);
		for (const [key, entry] of this.entries) {
			if (entry.tags.some((tag) => tags.includes(tag))) this.entries.delete(key);
		}
	}
}

function cacheRecord(value: IncrementalCacheValue | null): CacheRecord {
	return {
		value,
		tags: [],
		lastModified: 1_700_000_000_000,
		revalidateAt: 1_700_000_060_000,
		expireAt: 1_700_000_120_000,
		cacheControl: { revalidate: 60, expire: 120 },
	};
}

function fetchValue(value: unknown, tags: string[] = [], revalidate = 60): IncrementalCacheValue {
	return {
		kind: 'FETCH',
		data: {
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(value),
			url: 'https://example.com/data',
			status: 200,
		},
		tags,
		revalidate,
	};
}

function readFetchValue(value: Awaited<ReturnType<WorkersCacheHandler['get']>>): unknown {
	return value?.value?.kind === 'FETCH' ? JSON.parse(value.value.data.body) : null;
}

function bytes(...values: number[]): ArrayBuffer {
	return new Uint8Array(values).buffer;
}

function normalize(value: CacheRecord): unknown {
	return JSON.parse(
		JSON.stringify(value, (_key, item) =>
			item instanceof ArrayBuffer ? Array.from(new Uint8Array(item)) : item,
		),
	);
}
