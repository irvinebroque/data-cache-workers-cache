import { validateTags, validateTtl } from './cache-protocol';
import type { VinextDataCacheStub, WorkersCacheTrace } from './workers-cache-handler';

const MAX_DEMO_REQUEST_BYTES = 128 * 1024;

export type DemoOperation = 'read-through' | 'overwrite' | 'delete' | 'expire-tag';

export type DemoExecution = {
	entrypoint: VinextDataCacheStub;
	operation: DemoOperation;
	key: string;
	tags: string[];
	ttl: number;
	value?: JsonValue;
	hasValue: boolean;
	allowUnverifiedLocalWrites: boolean;
	onTrace(trace: WorkersCacheTrace): void;
};

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type DemoExecutionResult = {
	source: 'cache' | 'origin' | 'write' | 'purge';
	value: JsonValue;
};

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
	entrypoint: VinextDataCacheStub,
	operation: DemoOperation,
	execute: (input: DemoExecution) => Promise<DemoExecutionResult>,
): Promise<Response> {
	const startedAt = performance.now();
	const requestId = crypto.randomUUID();
	let input: DemoInput;

	try {
		input = await readDemoInput(request);
		if (operation === 'overwrite' && !input.hasValue) throw new TypeError('A JSON value is required');
		if (operation === 'expire-tag' && input.tags.length === 0) throw new TypeError('At least one tag is required');
	} catch (error) {
		return demoError(requestId, error, 400);
	}

	try {
		const namespace = (await sha256(input.sessionId)).slice(0, 16);
		const keyPrefix = `demo:${namespace}:`;
		const tagPrefix = `demo:${namespace}:`;
		const internalKey = `${keyPrefix}${input.key}`;
		const internalTags = validateTags(input.tags.map((tag) => `${tagPrefix}${tag}`));
		const traces: WorkersCacheTrace[] = [];
		const { source, value } = await execute({
			entrypoint,
			operation,
			key: internalKey,
			tags: internalTags,
			ttl: input.ttl,
			value: input.value,
			hasValue: input.hasValue,
			allowUnverifiedLocalWrites: request.cf === undefined,
			onTrace(trace) {
				traces.push({
					...trace,
					key: trace.key?.startsWith(keyPrefix) ? trace.key.slice(keyPrefix.length) : trace.key,
					tags: trace.tags?.map((tag) => (tag.startsWith(tagPrefix) ? tag.slice(tagPrefix.length) : tag)),
				});
			},
		});

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
		return demoError(requestId, error, 502);
	}
}

function demoError(requestId: string, error: unknown, status: number): Response {
	return Response.json(
		{
			requestId,
			error: error instanceof Error ? error.message : String(error),
		},
		{ status, headers: { 'Cache-Control': 'no-store' } },
	);
}

async function readDemoInput(request: Request): Promise<DemoInput> {
	const body = await readBoundedRequestBody(request);

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
	const tags = validateTags(parsed.tags, 10);
	if (tags.some((tag) => tag.length > 1000)) throw new TypeError('Demo tags must not exceed 1000 characters');
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

async function readBoundedRequestBody(request: Request): Promise<string> {
	const contentLength = request.headers.get('Content-Length');
	if (contentLength !== null) {
		if (!/^\d+$/.test(contentLength)) throw new TypeError('Invalid Content-Length');
		const declaredLength = Number(contentLength);
		if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_DEMO_REQUEST_BYTES) {
			throw new RangeError('Demo request is too large');
		}
	}
	if (!request.body) return '';

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	let completed = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			byteLength += value.byteLength;
			if (byteLength > MAX_DEMO_REQUEST_BYTES) throw new RangeError('Demo request is too large');
			chunks.push(value);
		}
		completed = true;
	} finally {
		if (!completed) {
			try {
				await reader.cancel();
			} catch {}
		}
		reader.releaseLock();
	}

	const body = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
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
