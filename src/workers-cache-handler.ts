import { cacheRecordDigest, decodeCacheRecord, encodeCacheRecord, readBoundedResponseBody } from './cache-codec';
import {
	cacheIdentity,
	cacheNamespaceTag,
	cacheTag,
	CACHE_URL,
	DEFAULT_STORAGE_TTL_SECONDS,
	DIGEST_HEADER,
	EXECUTED_AT_HEADER,
	EXECUTION_ID_HEADER,
	PATH_TAG_PREFIX,
	validateTags,
} from './cache-protocol';
import type { CachePublishInput, CachePublishResult } from './data-cache';
import type {
	CacheControlMetadata,
	CacheHandler,
	CacheHandlerValue,
	IncrementalCacheValue,
} from './cache-types';
import { getRequestExecutionContext } from 'vinext/shims/request-context';

export type VinextDataCacheStub = {
	fetch(input: string | Request, init?: RequestInit): Promise<Response>;
	publish(record: Response, input: CachePublishInput): Promise<CachePublishResult>;
	purgeTags(tags: string[]): Promise<void>;
};

export type WorkersCacheHandlerOptions = {
	appPrefix?: string;
	storageTtlSeconds?: number;
	allowUnverifiedLocalWrites?: boolean;
	onTrace?: (trace: WorkersCacheTrace) => void;
};

export type WorkersCacheTrace = {
	operation: 'get' | 'set' | 'delete' | 'revalidateTag';
	outcome: 'hit' | 'miss' | 'stored' | 'purged';
	key?: string;
	tags?: string[];
	cacheKey?: string;
	cacheStatus?: string;
	httpStatus?: number;
	dataCacheExecutionId?: string;
	dataCacheExecutedAt?: string;
	dataCacheExecuted?: boolean;
	writeId?: string;
	digest?: string;
	attempts?: number;
	durationMs: number;
	request: {
		method: 'GET' | 'RPC';
		url?: string;
		valueBytes?: number;
	};
};

export class WorkersCacheHandler implements CacheHandler {
	readonly #entrypoint: VinextDataCacheStub;
	readonly #appPrefix: string;
	readonly #storageTtlSeconds: number;
	readonly #allowUnverifiedLocalWrites: boolean;
	readonly #onTrace?: (trace: WorkersCacheTrace) => void;

	constructor(entrypoint: VinextDataCacheStub, options: WorkersCacheHandlerOptions = {}) {
		this.#entrypoint = entrypoint;
		this.#appPrefix = options.appPrefix ?? '';
		this.#storageTtlSeconds = positiveInteger(options.storageTtlSeconds ?? DEFAULT_STORAGE_TTL_SECONDS, 'storageTtlSeconds');
		this.#allowUnverifiedLocalWrites = options.allowUnverifiedLocalWrites ?? false;
		this.#onTrace = options.onTrace;
	}

	async get(key: string, ctx?: Record<string, unknown>): Promise<CacheHandlerValue | null> {
		const startedAt = performance.now();
		const { cacheKey } = await cacheIdentity(key, this.#appPrefix);
		const response = await this.#entrypoint.fetch(CACHE_URL, { cf: { cacheKey } });
		const responseTrace = traceResponse(response);

		if (response.status === 404) {
			await response.body?.cancel();
			this.#onTrace?.({
				operation: 'get',
				outcome: 'miss',
				key,
				cacheKey,
				...responseTrace,
				dataCacheExecuted: true,
				durationMs: elapsed(startedAt),
				request: { method: 'GET', url: CACHE_URL },
			});
			return null;
		}
		if (!response.ok) throw new Error(`Workers data cache read failed (${response.status})`);

		let record;
		try {
			const encoded = await readBoundedResponseBody(response);
			const expectedDigest = response.headers.get(DIGEST_HEADER);
			if (!expectedDigest || (await cacheRecordDigest(encoded)) !== expectedDigest) {
				throw new Error('Data cache record failed digest verification');
			}
			record = decodeCacheRecord(encoded);
		} catch (error) {
			console.error(
				JSON.stringify({
					message: 'invalid Workers data cache record',
					cacheKey,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
			return null;
		}

		const now = Date.now();
		if (record.expireAt !== null && now > record.expireAt) return null;
		const requestedRevalidate = readPositiveNumber(ctx, 'revalidate');
		const requestedRevalidateAt =
			requestedRevalidate === undefined ? null : record.lastModified + requestedRevalidate * 1000;
		const stale =
			(record.revalidateAt !== null && now > record.revalidateAt) ||
			(requestedRevalidateAt !== null && now > requestedRevalidateAt);

		this.#onTrace?.({
			operation: 'get',
			outcome: 'hit',
			key,
			cacheKey,
			...responseTrace,
			dataCacheExecuted: false,
			digest: response.headers.get(DIGEST_HEADER) ?? undefined,
			durationMs: elapsed(startedAt),
			request: { method: 'GET', url: CACHE_URL },
		});
		return {
			lastModified: record.lastModified,
			value: record.value,
			cacheControl: record.cacheControl,
			...(stale ? { cacheState: 'stale' } : {}),
		};
	}

	set(key: string, data: IncrementalCacheValue | null, ctx?: Record<string, unknown>): Promise<void> {
		const publication = this.publish(key, data, ctx);
		getRequestExecutionContext()?.waitUntil(publication);
		return publication;
	}

	private async publish(key: string, data: IncrementalCacheValue | null, ctx?: Record<string, unknown>): Promise<void> {
		const startedAt = performance.now();
		const effectiveRevalidate = readEffectiveRevalidate(data, ctx);
		if (effectiveRevalidate === 0) return;
		const effectiveExpire = readCacheControlNumber(ctx, 'expire');
		const tags = collectTags(data, ctx);
		const now = Date.now();
		const revalidateAt =
			typeof effectiveRevalidate === 'number' && effectiveRevalidate > 0
				? now + effectiveRevalidate * 1000
				: null;
		const expireAt =
			typeof effectiveExpire === 'number' && effectiveExpire > 0 ? now + effectiveExpire * 1000 : null;
		const cacheControl: CacheControlMetadata | undefined =
			typeof effectiveRevalidate === 'number'
				? effectiveExpire === undefined
					? { revalidate: effectiveRevalidate }
					: { revalidate: effectiveRevalidate, expire: effectiveExpire }
				: undefined;
		const encoded = encodeCacheRecord({ value: data, tags, lastModified: now, revalidateAt, expireAt, cacheControl });
		const digest = await cacheRecordDigest(encoded);
		const writeId = crypto.randomUUID();
		const { cacheKey, keyTag } = await cacheIdentity(key, this.#appPrefix);
		const [namespaceTag, ...hardTags] = await Promise.all([
			cacheNamespaceTag(this.#appPrefix),
			...tags.map((tag) => cacheTag(tag, this.#appPrefix)),
		]);
		const physicalTtl = Math.max(this.#storageTtlSeconds, Math.ceil(effectiveExpire ?? 0));
		const result = await this.#entrypoint.publish(new Response(encoded), {
			key,
			appPrefix: this.#appPrefix,
			cacheTags: [keyTag, namespaceTag, ...hardTags],
			physicalTtl,
			writeId,
			digest,
			byteLength: encoded.byteLength,
			allowUnverifiedLocal: this.#allowUnverifiedLocalWrites,
		});

		this.#onTrace?.({
			operation: 'set',
			outcome: 'stored',
			key,
			tags,
			cacheKey,
			writeId,
			digest,
			cacheStatus: result.cacheStatus,
			httpStatus: result.httpStatus,
			dataCacheExecutionId: result.dataCacheExecutionId,
			dataCacheExecutedAt: result.dataCacheExecutedAt,
			dataCacheExecuted: true,
			attempts: result.attempts,
			durationMs: elapsed(startedAt),
			request: { method: 'RPC', valueBytes: encoded.byteLength },
		});
	}

	async revalidateTag(tags: string | string[], _durations?: { expire?: number }): Promise<void> {
		const startedAt = performance.now();
		const logicalTags = validateTags(Array.isArray(tags) ? tags : [tags]);
		const purgeTags = await Promise.all(logicalTags.map((tag) => cacheTag(tag, this.#appPrefix)));
		if (logicalTags.some((tag) => tag.startsWith(PATH_TAG_PREFIX))) {
			purgeTags.push(await cacheNamespaceTag(this.#appPrefix));
		}
		if (purgeTags.length === 0) return;
		await this.#entrypoint.purgeTags([...new Set(purgeTags)]);
		this.#onTrace?.({
			operation: 'revalidateTag',
			outcome: 'purged',
			tags: logicalTags,
			dataCacheExecuted: true,
			durationMs: elapsed(startedAt),
			request: { method: 'RPC' },
		});
	}

	async delete(key: string): Promise<void> {
		const startedAt = performance.now();
		const { keyTag } = await cacheIdentity(key, this.#appPrefix);
		await this.#entrypoint.purgeTags([keyTag]);
		this.#onTrace?.({
			operation: 'delete',
			outcome: 'purged',
			key,
			dataCacheExecuted: true,
			durationMs: elapsed(startedAt),
			request: { method: 'RPC' },
		});
	}

	resetRequestCache(): void {}
}

export type WorkersCacheAdapterOptions = Pick<WorkersCacheHandlerOptions, 'appPrefix' | 'storageTtlSeconds'>;

const createWorkersCacheHandler = ({
	options,
}: {
	env?: Record<string, unknown>;
	options?: WorkersCacheAdapterOptions;
}): CacheHandler => {
	// Adapter registration occurs before vinext installs its request context.
	// CacheStorage is the runtime capability this protocol requires and is absent
	// from vinext's Node.js development server.
	if (typeof caches === 'undefined') {
		throw new Error('[vinext] The Workers Cache data adapter requires the Cloudflare Workers runtime.');
	}
	return new WorkersCacheHandler(
		{
			fetch: (...args) => resolveLoopbackEntrypoint().fetch(...args),
			publish: (...args) => resolveLoopbackEntrypoint().publish(...args),
			purgeTags: (...args) => resolveLoopbackEntrypoint().purgeTags(...args),
		},
		options,
	);
};

export default createWorkersCacheHandler;

function resolveLoopbackEntrypoint(): VinextDataCacheStub {
	const context = getRequestExecutionContext();
	if (!context || !hasVinextDataCacheExport(context)) {
		throw new Error(
			'[vinext] The Workers Cache data adapter requires VinextDataCache to be exported from the Worker entry module.',
		);
	}
	return context.exports.VinextDataCache;
}

function hasVinextDataCacheExport(value: object): value is {
	exports: { VinextDataCache: VinextDataCacheStub };
} {
	if (!('exports' in value) || !isRecord(value.exports)) return false;
	const entrypoint = value.exports.VinextDataCache;
	return (typeof entrypoint === 'object' && entrypoint !== null) || typeof entrypoint === 'function';
}

function collectTags(data: IncrementalCacheValue | null, ctx?: Record<string, unknown>): string[] {
	const tags: string[] = [];
	if (data && 'tags' in data && Array.isArray(data.tags)) tags.push(...data.tags);
	const contextTags = ctx?.tags;
	if (Array.isArray(contextTags)) tags.push(...contextTags.filter((tag): tag is string => typeof tag === 'string'));
	return validateTags(tags);
}

function readEffectiveRevalidate(data: IncrementalCacheValue | null, ctx?: Record<string, unknown>): number | undefined {
	if (data && 'revalidate' in data && typeof data.revalidate === 'number') return data.revalidate;
	return readCacheControlNumber(ctx, 'revalidate');
}

function readCacheControlNumber(ctx: Record<string, unknown> | undefined, field: string): number | undefined {
	const cacheControl = ctx?.cacheControl;
	const nested = isRecord(cacheControl) ? cacheControl[field] : undefined;
	const value = nested ?? ctx?.[field];
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readPositiveNumber(ctx: Record<string, unknown> | undefined, field: string): number | undefined {
	const value = ctx?.[field];
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
	return value;
}

function traceResponse(response: Response): Pick<
	WorkersCacheTrace,
	'cacheStatus' | 'httpStatus' | 'dataCacheExecutionId' | 'dataCacheExecutedAt' | 'writeId'
> {
	return {
		cacheStatus: response.headers.get('Cf-Cache-Status') ?? undefined,
		httpStatus: response.status,
		dataCacheExecutionId: response.headers.get(EXECUTION_ID_HEADER) ?? undefined,
		dataCacheExecutedAt: response.headers.get(EXECUTED_AT_HEADER) ?? undefined,
		writeId: response.headers.get('X-Vinext-Cache-Write-Id') ?? undefined,
	};
}

function elapsed(startedAt: number): number {
	return Math.round((performance.now() - startedAt) * 10) / 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
