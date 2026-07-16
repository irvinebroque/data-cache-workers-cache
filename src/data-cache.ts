import { WorkerEntrypoint } from 'cloudflare:workers';
import { cacheRecordDigest, readBoundedResponseBody } from './cache-codec';
import {
	cacheIdentity,
	CACHE_URL,
	DIGEST_HEADER,
	EXECUTED_AT_HEADER,
	EXECUTION_ID_HEADER,
	MAILBOX_CACHE_NAME,
	MAILBOX_HEADER,
	mailboxRequest,
	MAILBOX_TTL_SECONDS,
	MAX_PURGE_OPERATIONS,
	MAX_RECORD_BYTES,
	requiredHeader,
	TAGS_HEADER,
	TTL_HEADER,
	validateCacheHeaderTags,
	validateCloudflareTags,
	validateDigest,
	validateTtl,
	validateWriteId,
	WRITE_ID_HEADER,
} from './cache-protocol';

export type CachePublishInput = {
	key: string;
	appPrefix: string;
	cacheTags: string[];
	physicalTtl: number;
	writeId: string;
	digest: string;
	byteLength: number;
	allowUnverifiedLocal?: boolean;
};

export type CachePublishResult = {
	writeId: string;
	digest: string;
	cacheStatus?: string;
	httpStatus: number;
	dataCacheExecutionId?: string;
	dataCacheExecutedAt?: string;
	attempts: number;
};

/** The named entrypoint whose GET responses are authoritative in Workers Cache. */
export class VinextDataCache extends WorkerEntrypoint<Env> {
	async fetch(request: Request): Promise<Response> {
		const executionHeaders = {
			[EXECUTION_ID_HEADER]: crypto.randomUUID(),
			[EXECUTED_AT_HEADER]: new Date().toISOString(),
		};
		const nonce = request.headers.get(MAILBOX_HEADER);
		if (!nonce) {
			return new Response(null, {
				status: 404,
				headers: { 'Cache-Control': 'no-store', ...executionHeaders },
			});
		}

		try {
			const mailbox = await caches.open(MAILBOX_CACHE_NAME);
			const pending = await mailbox.match(mailboxRequest(nonce));
			if (!pending?.body) {
				return new Response(null, {
					status: 404,
					headers: { 'Cache-Control': 'no-store', ...executionHeaders },
				});
			}

			const ttl = validateTtl(Number(requiredHeader(pending.headers, TTL_HEADER)));
			const tags = validateCacheHeaderTags(requiredHeader(pending.headers, TAGS_HEADER).split(','));
			const writeId = validateWriteId(requiredHeader(pending.headers, WRITE_ID_HEADER));
			const digest = validateDigest(requiredHeader(pending.headers, DIGEST_HEADER));

			return new Response(pending.body, {
				headers: {
					'Cache-Control': `public, max-age=${ttl}, stale-if-error=0`,
					'Cache-Tag': tags.join(','),
					'Content-Type': 'application/octet-stream',
					ETag: `"sha256-${digest}"`,
					[WRITE_ID_HEADER]: writeId,
					[DIGEST_HEADER]: digest,
					...executionHeaders,
				},
			});
		} catch (error) {
			return Response.json(
				{ error: error instanceof Error ? error.message : String(error) },
				{ status: 400, headers: { 'Cache-Control': 'no-store', ...executionHeaders } },
			);
		}
	}

	async publish(record: Response, input: CachePublishInput): Promise<CachePublishResult> {
		if (!record.body) throw new TypeError('Data cache publish requires a response body');
		if (!Number.isSafeInteger(input.byteLength) || input.byteLength <= 0 || input.byteLength > MAX_RECORD_BYTES) {
			throw new RangeError(`Data cache record must contain 1-${MAX_RECORD_BYTES} bytes`);
		}

		const { cacheKey, keyTag } = await cacheIdentity(input.key, input.appPrefix);
		const cacheTags = validateCacheHeaderTags(input.cacheTags);
		if (!cacheTags.includes(keyTag)) throw new TypeError('Data cache publish is missing its key tag');
		const physicalTtl = validateTtl(input.physicalTtl);
		const writeId = validateWriteId(input.writeId);
		const digest = validateDigest(input.digest);
		const encoded = await readBoundedResponseBody(record);
		if (encoded.byteLength !== input.byteLength) throw new Error('Data cache record length does not match publication metadata');
		if ((await cacheRecordDigest(encoded)) !== digest) throw new Error('Data cache record digest does not match publication metadata');
		const nonce = crypto.randomUUID();
		const mailboxKey = mailboxRequest(nonce);
		const mailbox = await caches.open(MAILBOX_CACHE_NAME);

		await mailbox.put(
			mailboxKey,
			new Response(encoded, {
				headers: {
					'Cache-Control': `public, max-age=${MAILBOX_TTL_SECONDS}`,
					'Content-Type': 'application/octet-stream',
					[TAGS_HEADER]: cacheTags.join(','),
					[TTL_HEADER]: String(physicalTtl),
					[WRITE_ID_HEADER]: writeId,
					[DIGEST_HEADER]: digest,
				},
			}),
		);

		try {
			const staged = await mailbox.match(mailboxKey);
			if (!staged) throw new Error('Data cache mailbox did not retain the published record');
			await staged.body?.cancel();

			let attempts = 0;
			let lastFailure = 'Workers Cache did not return the published record';

			for (const delay of [0, 50, 150, 500, 1000]) {
				if (delay > 0) await scheduler.wait(delay);
				attempts++;
				const response = await this.ctx.exports.VinextDataCache.fetch(CACHE_URL, {
					headers: {
						'Cache-Control': 'no-cache',
						[MAILBOX_HEADER]: nonce,
					},
					cf: { cacheKey },
				});
				let returned: ArrayBuffer;
				try {
					returned = await readBoundedResponseBody(response);
				} catch (error) {
					lastFailure = error instanceof Error ? error.message : String(error);
					continue;
				}
				const returnedWriteId = response.headers.get(WRITE_ID_HEADER);
				const returnedDigest = response.headers.get(DIGEST_HEADER);

				if (response.ok && returnedWriteId === writeId && returnedDigest === digest) {
					const actualDigest = await cacheRecordDigest(returned);
					if (actualDigest === digest) {
						// Local workerd has no Workers Cache handle or cache-status header.
						// If the handle exists, a missing header is a deployment error.
						if (!response.headers.has('Cf-Cache-Status')) {
							if (input.allowUnverifiedLocal && !this.ctx.cache) {
								return publishResult(response, writeId, digest, attempts);
							}
							throw new Error('Workers Cache fill did not return Cf-Cache-Status');
						}

						const persisted = await this.ctx.exports.VinextDataCache.fetch(CACHE_URL, { cf: { cacheKey } });
						let persistedBody: ArrayBuffer;
						try {
							persistedBody = await readBoundedResponseBody(persisted);
						} catch (error) {
							lastFailure = error instanceof Error ? error.message : String(error);
							continue;
						}
						const persistedWriteId = persisted.headers.get(WRITE_ID_HEADER);
						const persistedDigest = persisted.headers.get(DIGEST_HEADER);
						if (
							persisted.ok &&
							persistedWriteId === writeId &&
							persistedDigest === digest &&
							(await cacheRecordDigest(persistedBody)) === digest
						) {
							return publishResult(persisted, writeId, digest, attempts);
						}
						lastFailure = `Workers Cache persistence check returned ${persisted.status} with a different write ID`;
						continue;
					}
					lastFailure = 'Data cache fill body failed digest verification';
				} else {
					lastFailure = `Data cache fill returned ${response.status} with a different write ID`;
				}
			}

			throw new Error(lastFailure);
		} finally {
			try {
				await mailbox.delete(mailboxKey);
			} catch (error) {
				console.warn(
					JSON.stringify({
						message: 'failed to delete data cache mailbox',
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			}
		}
	}

	async purgeTags(tags: string[]): Promise<void> {
		if (!this.ctx.cache) throw new Error('Workers Cache is not enabled for VinextDataCache');
		const validated = validateCloudflareTags(tags);
		for (let offset = 0; offset < validated.length; offset += MAX_PURGE_OPERATIONS) {
			const result = await this.ctx.cache.purge({ tags: validated.slice(offset, offset + MAX_PURGE_OPERATIONS) });
			if (!result.success) {
				throw new Error(`Data cache purge failed: ${result.errors.map((error) => error.message).join(', ')}`);
			}
		}
	}
}

function publishResult(response: Response, writeId: string, digest: string, attempts: number): CachePublishResult {
	return {
		writeId,
		digest,
		cacheStatus: response.headers.get('Cf-Cache-Status') ?? undefined,
		httpStatus: response.status,
		dataCacheExecutionId: response.headers.get(EXECUTION_ID_HEADER) ?? undefined,
		dataCacheExecutedAt: response.headers.get(EXECUTED_AT_HEADER) ?? undefined,
		attempts,
	};
}
