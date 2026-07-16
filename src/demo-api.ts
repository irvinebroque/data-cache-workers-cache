import { validateTags, validateTtl } from './cache-protocol';
import {
	getCache,
	type DataCacheStub,
	type JsonValue,
	type RuntimeCacheTrace,
} from './runtime-cache';

const BLOG_API = 'https://api.vercel.app/blog';
const MAX_DEMO_REQUEST_BYTES = 128 * 1024;

type DemoInput = {
	sessionId: string;
	key: string;
	ttl: number;
	tags: string[];
	value?: JsonValue;
	hasValue: boolean;
};

export async function handleDemoApi(
	request: Request,
	entrypoint: DataCacheStub,
	operation: string,
): Promise<Response> {
	const startedAt = performance.now();
	const requestId = crypto.randomUUID();

	try {
		const input = await readDemoInput(request);
		const namespace = (await sha256(input.sessionId)).slice(0, 16);
		const keyPrefix = `demo:${namespace}:`;
		const tagPrefix = `demo:${namespace}:`;
		const internalKey = `${keyPrefix}${input.key}`;
		const internalTags = validateTags(input.tags.map((tag) => `${tagPrefix}${tag}`));
		const traces: RuntimeCacheTrace[] = [];
		const cache = getCache(entrypoint, {
			onTrace(trace) {
				traces.push({
					...trace,
					key: trace.key?.startsWith(keyPrefix) ? trace.key.slice(keyPrefix.length) : trace.key,
					tags: trace.tags?.map((tag) => (tag.startsWith(tagPrefix) ? tag.slice(tagPrefix.length) : tag)),
				});
			},
		});

		let source: 'cache' | 'origin' | 'write' | 'purge';
		let value: JsonValue;

		switch (operation) {
			case 'read-through': {
				const cached = await cache.get<JsonValue>(internalKey);
				if (cached !== null) {
					source = 'cache';
					value = cached;
					break;
				}

				const upstream = await fetch(BLOG_API);
				if (!upstream.ok) throw new Error(`Blog API failed with ${upstream.status}`);

				value = await upstream.json<JsonValue>();
				await cache.set(internalKey, value, { ttl: input.ttl, tags: internalTags });
				source = 'origin';
				break;
			}
			case 'overwrite': {
				if (!input.hasValue) throw new TypeError('A JSON value is required for overwrite');
				await cache.set(internalKey, input.value!, { ttl: input.ttl, tags: internalTags });
				const readBack = await cache.get<JsonValue>(internalKey);
				value = { written: input.value!, readBack };
				source = 'write';
				break;
			}
			case 'delete': {
				await cache.delete(internalKey);
				value = { afterDelete: await cache.get<JsonValue>(internalKey) };
				source = 'purge';
				break;
			}
			case 'expire-tag': {
				if (internalTags.length === 0) throw new TypeError('At least one tag is required');
				await cache.expireTag(internalTags);
				value = { afterExpiration: await cache.get<JsonValue>(internalKey) };
				source = 'purge';
				break;
			}
			default:
				return new Response('Not found', { status: 404 });
		}

		return Response.json(
			{
				requestId,
				operation,
				source,
				key: input.key,
				tags: input.tags,
				ttl: input.ttl,
				colo: request.cf?.colo ?? 'local',
				durationMs: elapsed(startedAt),
				value,
				traces,
			},
			{ headers: { 'Cache-Control': 'no-store' } },
		);
	} catch (error) {
		const clientError = error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError;
		return Response.json(
			{
				requestId,
				error: error instanceof Error ? error.message : String(error),
			},
			{ status: clientError ? 400 : 502, headers: { 'Cache-Control': 'no-store' } },
		);
	}
}

async function readDemoInput(request: Request): Promise<DemoInput> {
	const contentLength = Number(request.headers.get('Content-Length') ?? 0);
	if (contentLength > MAX_DEMO_REQUEST_BYTES) throw new RangeError('Demo request is too large');

	const body = await request.text();
	if (new TextEncoder().encode(body).byteLength > MAX_DEMO_REQUEST_BYTES) {
		throw new RangeError('Demo request is too large');
	}

	const parsed: unknown = JSON.parse(body);
	if (!isRecord(parsed)) throw new TypeError('Expected a JSON object');
	if (typeof parsed.sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(parsed.sessionId)) {
		throw new TypeError('Invalid demo session');
	}
	if (typeof parsed.key !== 'string' || parsed.key.length === 0 || parsed.key.length > 512) {
		throw new TypeError('Cache key must contain between 1 and 512 characters');
	}
	if (!Array.isArray(parsed.tags) || !parsed.tags.every((tag) => typeof tag === 'string')) {
		throw new TypeError('Tags must be an array of strings');
	}
	if (typeof parsed.ttl !== 'number') throw new TypeError('TTL must be a number');

	const ttl = validateTtl(parsed.ttl);
	const tags = validateTags(parsed.tags);
	const hasValue = Object.hasOwn(parsed, 'value');
	if (hasValue && !isJsonValue(parsed.value)) throw new TypeError('Value must be valid JSON');

	return {
		sessionId: parsed.sessionId,
		key: parsed.key,
		ttl,
		tags,
		value: parsed.value as JsonValue | undefined,
		hasValue,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (isRecord(value)) return Object.values(value).every(isJsonValue);
	return false;
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function elapsed(startedAt: number): number {
	return Math.round((performance.now() - startedAt) * 10) / 10;
}
