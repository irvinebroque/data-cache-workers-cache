import { createExecutionContext, env, fetchMock, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataCache, getCache, type DataCacheStub } from '../src/index';

describe('Workers Cache runtime API prototype', () => {
	beforeAll(() => {
		fetchMock.activate();
		fetchMock.disableNetConnect();
	});

	afterEach(() => fetchMock.assertNoPendingInterceptors());

	it('round-trips and overwrites values through cacheable GET responses', async () => {
		const dataCache = new DataCache(createExecutionContext(), env);
		const stored = new Map<string, Response>();
		const stub: DataCacheStub = {
			fetch: vi.fn(async (input, init) => {
				const cacheKey = init?.cf?.cacheKey;
				if (!cacheKey) throw new Error('Missing custom cache key');

				const request = new Request(input, init);
				const forceRevalidation = request.headers.get('Cache-Control') === 'no-cache';
				if (!forceRevalidation && stored.has(cacheKey)) return stored.get(cacheKey)!.clone();

				const response = await dataCache.fetch(request);
				if (response.ok) stored.set(cacheKey, response.clone());
				return response;
			}),
			purgeTags: vi.fn(),
		};
		const cache = getCache(stub);

		expect(await cache.get('greeting')).toBeNull();
		await cache.set('greeting', { message: 'hello' }, { ttl: 60, tags: ['messages'] });
		expect(await cache.get('greeting')).toEqual({ message: 'hello' });

		await cache.set('greeting', { message: 'updated' }, { ttl: 120, tags: ['messages'] });
		expect(await cache.get('greeting')).toEqual({ message: 'updated' });
		expect(stub.fetch).toHaveBeenCalledTimes(5);
	});

	it('sets cache policy, tags, and write verification on a supplied value', async () => {
		const request = new Request('https://data-cache.internal/value', {
			headers: {
				'X-Data-Cache-Operation': 'set',
				'X-Data-Cache-Value': btoa(JSON.stringify({ cached: true })),
				'X-Data-Cache-Tags': 'example',
				'X-Data-Cache-Key-Tag': '__key:abc',
				'X-Data-Cache-Ttl': '300',
				'X-Data-Cache-Write-Id': 'write-1',
			},
		});
		const response = await new DataCache(createExecutionContext(), env).fetch(request);

		expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, stale-if-error=0');
		expect(response.headers.get('Cache-Tag')).toBe('example,__key:abc');
		expect(response.headers.get('X-Data-Cache-Write-Id')).toBe('write-1');
		expect(await response.json()).toEqual({ cached: true });
	});

	it('maps delete and tag expiration to entrypoint-scoped purges', async () => {
		const purgeTags = vi.fn(async (_tags: string[]) => undefined);
		const cache = getCache({ fetch: vi.fn(), purgeTags });

		await cache.delete('greeting');
		await cache.expireTag(['messages', 'blog']);

		expect(purgeTags).toHaveBeenCalledTimes(2);
		expect(purgeTags).toHaveBeenNthCalledWith(1, [expect.stringMatching(/^__key:[a-f0-9]{64}$/)]);
		expect(purgeTags).toHaveBeenLastCalledWith(['messages', 'blog']);
	});

	it('calls Workers Cache purge from the cache-owning entrypoint', async () => {
		const ctx = createExecutionContext();
		const purge = vi.fn(async () => ({ success: true, errors: [] }));
		Object.defineProperty(ctx, 'cache', { value: { purge } });

		await new DataCache(ctx, env).purgeTags(['blog']);
		expect(purge).toHaveBeenCalledWith({ tags: ['blog'] });
	});

	it('uses the get/set facade from the application entrypoint', async () => {
		fetchMock
			.get('https://api.vercel.app')
			.intercept({ method: 'GET', path: '/blog' })
			.reply(200, JSON.stringify([{ title: 'prototype' }]), {
				headers: { 'Content-Type': 'application/json' },
			});

		const response = await SELF.fetch('https://example.com/');
		const body = await response.json<{ dataCache: string; data: unknown }>();

		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(body.dataCache).toBe('miss');
		expect(body.data).toEqual([{ title: 'prototype' }]);
	});
});
