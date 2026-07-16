import { createExecutionContext, env, fetchMock, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataCache } from '../src/index';

describe('Workers Cache contract', () => {
	beforeAll(() => {
		fetchMock.activate();
		fetchMock.disableNetConnect();
	});

	afterEach(() => fetchMock.assertNoPendingInterceptors());

	it('marks upstream data as cacheable and tagged', async () => {
		fetchMock
			.get('https://api.vercel.app')
			.intercept({ method: 'GET', path: '/blog' })
			.reply(200, JSON.stringify([{ title: 'cached' }]), {
				headers: { 'Content-Type': 'application/json' },
			});

		const dataCache = new DataCache(createExecutionContext(), env);
		const response = await dataCache.fetch();

		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
		expect(response.headers.get('Cache-Tag')).toBe('blog');
		expect(response.headers.get('X-Data-Fetched-At')).not.toBeNull();
		expect(await response.json()).toEqual([{ title: 'cached' }]);
	});

	it('renders an uncached application response around the data', async () => {
		fetchMock
			.get('https://api.vercel.app')
			.intercept({ method: 'GET', path: '/blog' })
			.reply(200, JSON.stringify([{ title: 'rendered' }]), {
				headers: { 'Content-Type': 'application/json' },
			});

		const response = await SELF.fetch('https://example.com/');
		const body = await response.json<{
			renderId: string;
			dataFetchedAt: string;
			data: unknown;
		}>();

		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(body.renderId).toBeTypeOf('string');
		expect(body.dataFetchedAt).toBeTypeOf('string');
		expect(body.data).toEqual([{ title: 'rendered' }]);
	});

	it('maps tag revalidation to Workers Cache purge', async () => {
		const ctx = createExecutionContext();
		const purge = vi.fn(async () => ({ success: true, errors: [] }));
		Object.defineProperty(ctx, 'cache', { value: { purge } });

		const dataCache = new DataCache(ctx, env);
		expect(await dataCache.revalidateTag('blog')).toBe(true);
		expect(purge).toHaveBeenCalledWith({ tags: ['blog'] });
	});
});
