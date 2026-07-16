import {
	assertHeaderBudget,
	cacheIdentity,
	CACHE_URL,
	DEFAULT_TTL_SECONDS,
	encodeBase64,
	EXECUTED_AT_HEADER,
	EXECUTION_ID_HEADER,
	KEY_TAG_HEADER,
	OPERATION_HEADER,
	TAGS_HEADER,
	TTL_HEADER,
	validateTags,
	validateTtl,
	VALUE_HEADER,
	WRITE_ID_HEADER,
} from './cache-protocol';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type RuntimeCacheSetOptions = {
	ttl?: number;
	tags?: string[];
};

export type DataCacheStub = {
	fetch(input: string | Request, init?: RequestInit): Promise<Response>;
	purgeTags(tags: string[]): Promise<void>;
};

export type RuntimeCacheTrace = {
	operation: 'get' | 'set' | 'delete' | 'expireTag';
	outcome: 'hit' | 'miss' | 'stored' | 'purged';
	key?: string;
	tags?: string[];
	ttl?: number;
	cacheKey?: string;
	cacheStatus?: string;
	httpStatus?: number;
	dataCacheExecutionId?: string;
	dataCacheExecutedAt?: string;
	dataCacheExecuted?: boolean;
	writeId?: string;
	durationMs: number;
	request: {
		method: 'GET' | 'RPC';
		url?: string;
		cacheControl?: string;
		valueBytes?: number;
	};
};

export type RuntimeCacheOptions = {
	onTrace?: (trace: RuntimeCacheTrace) => void;
};

/** A Vercel Runtime Cache-shaped facade backed exclusively by Workers Cache. */
export function getCache(entrypoint: DataCacheStub, options: RuntimeCacheOptions = {}) {
	return {
		async get<T extends JsonValue>(key: string): Promise<T | null> {
			const startedAt = performance.now();
			const { cacheKey } = await cacheIdentity(key);
			const response = await entrypoint.fetch(CACHE_URL, { cf: { cacheKey } });
			const responseTrace = traceResponse(response);

			if (response.status === 404) {
				await response.body?.cancel();
				options.onTrace?.({
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

			const body = await response.text();
			if (!response.ok) {
				throw new Error(`Data cache read failed (${response.status}): ${body}`);
			}

			options.onTrace?.({
				operation: 'get',
				outcome: 'hit',
				key,
				cacheKey,
				...responseTrace,
				// A normal get can only receive a 200 from a cached set response.
				dataCacheExecuted: false,
				durationMs: elapsed(startedAt),
				request: { method: 'GET', url: CACHE_URL },
			});
			return JSON.parse(body) as T;
		},

		async set(key: string, value: JsonValue, setOptions: RuntimeCacheSetOptions = {}): Promise<void> {
			const startedAt = performance.now();
			const { cacheKey, keyTag } = await cacheIdentity(key);
			const ttl = validateTtl(setOptions.ttl ?? DEFAULT_TTL_SECONDS);
			const tags = validateTags(setOptions.tags ?? []);
			const serialized = JSON.stringify(value);
			const writeId = crypto.randomUUID();
			const headers = new Headers({
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

			options.onTrace?.({
				operation: 'set',
				outcome: 'stored',
				key,
				tags,
				ttl,
				cacheKey,
				writeId,
				...traceResponse(response),
				dataCacheExecuted: true,
				durationMs: elapsed(startedAt),
				request: {
					method: 'GET',
					url: CACHE_URL,
					cacheControl: 'no-cache',
					valueBytes: new TextEncoder().encode(serialized).byteLength,
				},
			});
		},

		async delete(key: string): Promise<void> {
			const startedAt = performance.now();
			const { keyTag } = await cacheIdentity(key);
			await entrypoint.purgeTags([keyTag]);
			options.onTrace?.({
				operation: 'delete',
				outcome: 'purged',
				key,
				tags: [keyTag],
				durationMs: elapsed(startedAt),
				request: { method: 'RPC' },
			});
		},

		async expireTag(tags: string | string[]): Promise<void> {
			const startedAt = performance.now();
			const validated = validateTags(Array.isArray(tags) ? tags : [tags]);
			await entrypoint.purgeTags(validated);
			options.onTrace?.({
				operation: 'expireTag',
				outcome: 'purged',
				tags: validated,
				durationMs: elapsed(startedAt),
				request: { method: 'RPC' },
			});
		},
	};
}

function traceResponse(response: Response): Pick<
	RuntimeCacheTrace,
	'cacheStatus' | 'httpStatus' | 'dataCacheExecutionId' | 'dataCacheExecutedAt' | 'writeId'
> {
	return {
		cacheStatus: response.headers.get('Cf-Cache-Status') ?? undefined,
		httpStatus: response.status,
		dataCacheExecutionId: response.headers.get(EXECUTION_ID_HEADER) ?? undefined,
		dataCacheExecutedAt: response.headers.get(EXECUTED_AT_HEADER) ?? undefined,
		writeId: response.headers.get(WRITE_ID_HEADER) ?? undefined,
	};
}

function elapsed(startedAt: number): number {
	return Math.round((performance.now() - startedAt) * 10) / 10;
}
