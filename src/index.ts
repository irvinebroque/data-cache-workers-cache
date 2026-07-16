import { WorkerEntrypoint } from 'cloudflare:workers';

const BLOG_API = 'https://api.vercel.app/blog';
const BLOG_TAG = 'blog';

// This entrypoint is the data cache. Workers Cache handles its GET requests
// before this code runs, so a hit never fetches the upstream API.
export class DataCache extends WorkerEntrypoint<Env> {
	async fetch(): Promise<Response> {
		const upstream = await fetch(BLOG_API);
		const headers = new Headers(upstream.headers);

		headers.delete('Set-Cookie');
		headers.set('Cache-Control', upstream.ok ? 'public, max-age=60' : 'no-store');
		headers.set('Cache-Tag', BLOG_TAG);
		headers.set('X-Data-Fetched-At', new Date().toISOString());

		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers,
		});
	}

	async revalidateTag(tag: string): Promise<boolean> {
		if (!this.ctx.cache) {
			throw new Error('Workers Cache is not enabled for DataCache');
		}

		const result = await this.ctx.cache.purge({ tags: [tag] });
		return result.success;
	}
}

// This entrypoint represents the application. It runs on every request and
// calls DataCache with a stable URL, just as Next.js caches an individual fetch.
export default {
	async fetch(request, _env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'POST' && url.pathname === '/revalidate') {
			const success = await ctx.exports.DataCache.revalidateTag(BLOG_TAG);
			return Response.json({ revalidated: success, tag: BLOG_TAG }, { status: success ? 200 : 500 });
		}

		if (request.method !== 'GET' || url.pathname !== '/') {
			return new Response('Not found', { status: 404 });
		}

		const dataResponse = await ctx.exports.DataCache.fetch('https://data-cache.internal/blog');
		if (!dataResponse.ok) {
			return new Response(dataResponse.body, {
				status: dataResponse.status,
				headers: { 'Cache-Control': 'no-store' },
			});
		}

		return Response.json(
			{
				renderId: crypto.randomUUID(),
				renderedAt: new Date().toISOString(),
				dataFetchedAt: dataResponse.headers.get('X-Data-Fetched-At'),
				dataCacheStatus: dataResponse.headers.get('Cf-Cache-Status'),
				data: await dataResponse.json(),
			},
			{ headers: { 'Cache-Control': 'no-store' } },
		);
	},
} satisfies ExportedHandler<Env>;
