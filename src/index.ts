import { DataCache } from './data-cache';
import { handleDemoApi } from './demo-api';
import { DEMO_HTML } from './demo-ui';
import { getCache } from './runtime-cache';

export { DataCache };
export {
	getCache,
	type DataCacheStub,
	type JsonValue,
	type RuntimeCacheOptions,
	type RuntimeCacheSetOptions,
	type RuntimeCacheTrace,
} from './runtime-cache';

export default {
	async fetch(request, _env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'GET' && url.pathname === '/') {
			return new Response(DEMO_HTML, {
				headers: {
					'Cache-Control': 'no-store',
					'Content-Security-Policy':
						"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
					'Content-Type': 'text/html; charset=utf-8',
					'Referrer-Policy': 'no-referrer',
					'X-Content-Type-Options': 'nosniff',
				},
			});
		}

		if (request.method === 'POST' && url.pathname.startsWith('/api/demo/')) {
			return handleDemoApi(request, ctx.exports.DataCache, url.pathname.slice('/api/demo/'.length));
		}

		// Retained as a small curl-friendly invalidation endpoint.
		if (request.method === 'POST' && url.pathname === '/revalidate') {
			await getCache(ctx.exports.DataCache).expireTag('blog');
			return Response.json({ revalidated: true, tag: 'blog' });
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
