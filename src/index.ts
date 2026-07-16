import { VinextDataCache } from './data-cache';
import {
	handleDemoApi,
	type DemoExecution,
	type DemoExecutionResult,
	type DemoOperation,
	type JsonValue,
} from './demo-api';
import { demoPage } from './demo-ui';
import { readBoundedResponseBody } from './cache-codec';
import { WorkersCacheHandler } from './workers-cache-handler';

const BLOG_API = 'https://api.vercel.app/blog';

export { VinextDataCache };

// This is the complete developer-facing API. The optional trace callback only
// supplies telemetry to the demo UI.
async function runCacheExample({
	entrypoint,
	onTrace,
	operation,
	key,
	tags,
	ttl,
	value,
	hasValue,
	allowUnverifiedLocalWrites,
}: DemoExecution): Promise<DemoExecutionResult> {
	const cache = new WorkersCacheHandler(entrypoint, { onTrace, allowUnverifiedLocalWrites });

	if (operation === 'read-through') {
		const cached = await cache.get(key);
		if (cached?.value?.kind === 'FETCH') {
			return { source: 'cache', value: JSON.parse(cached.value.data.body) as JsonValue };
		}

		const response = await fetch(BLOG_API);
		if (!response.ok) throw new Error(`Blog API failed with ${response.status}`);

		const posts = JSON.parse(new TextDecoder().decode(await readBoundedResponseBody(response))) as JsonValue;
		await cache.set(key, jsonCacheValue(key, posts, tags, ttl), { tags, revalidate: ttl });
		return { source: 'origin', value: posts };
	}

	if (operation === 'overwrite') {
		if (!hasValue || value === undefined) throw new TypeError('A JSON value is required');

		await cache.set(key, jsonCacheValue(key, value, tags, ttl), { tags, revalidate: ttl });
		const readBack = await cache.get(key);
		return {
			source: 'write',
			value: {
				written: value,
				readBack: readBack?.value?.kind === 'FETCH' ? (JSON.parse(readBack.value.data.body) as JsonValue) : null,
			},
		};
	}

	if (operation === 'delete') {
		await cache.delete(key);
		return { source: 'purge', value: { purgeAccepted: true } };
	}

	if (tags.length === 0) throw new TypeError('At least one tag is required');
	await cache.revalidateTag(tags);
	return { source: 'purge', value: { purgeAccepted: true } };
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'GET' && url.pathname === '/') return demoPage();

		const operation = url.pathname.slice('/api/demo/'.length);
		if (request.method === 'POST' && url.pathname.startsWith('/api/demo/') && isDemoOperation(operation)) {
			const { success } = await env.DEMO_REQUESTS.limit({
				key: request.headers.get('CF-Connecting-IP') ?? 'local',
			});
			if (!success) {
				return Response.json(
					{ error: 'Demo rate limit exceeded. Try again in a minute.' },
					{ status: 429, headers: { 'Cache-Control': 'no-store' } },
				);
			}
			if (operation === 'delete' || operation === 'expire-tag') {
				const purgeLimit = await env.DEMO_PURGES.limit({ key: 'demo-purges' });
				if (!purgeLimit.success) {
					return Response.json(
						{ error: 'Demo invalidation rate limit exceeded. Try again in a minute.' },
						{ status: 429, headers: { 'Cache-Control': 'no-store' } },
					);
				}
			}
			return handleDemoApi(request, ctx.exports.VinextDataCache, operation, runCacheExample);
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;

function isDemoOperation(value: string): value is DemoOperation {
	return value === 'read-through' || value === 'overwrite' || value === 'delete' || value === 'expire-tag';
}

function jsonCacheValue(key: string, value: JsonValue, tags: string[], revalidate: number) {
	return {
		kind: 'FETCH' as const,
		data: {
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(value),
			url: key,
			status: 200,
		},
		tags,
		revalidate,
	};
}

export { WorkersCacheHandler };
export type {
	VinextDataCacheStub,
	WorkersCacheAdapterOptions,
	WorkersCacheHandlerOptions,
	WorkersCacheTrace,
} from './workers-cache-handler';
export type { CacheHandler, CacheHandlerValue, IncrementalCacheValue } from './cache-types';
