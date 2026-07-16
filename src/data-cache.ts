import { WorkerEntrypoint } from 'cloudflare:workers';
import {
	decodeBase64,
	EXECUTED_AT_HEADER,
	EXECUTION_ID_HEADER,
	KEY_TAG_HEADER,
	MAX_TAGS,
	OPERATION_HEADER,
	requiredHeader,
	TAGS_HEADER,
	TTL_HEADER,
	validateTags,
	validateTtl,
	VALUE_HEADER,
	WRITE_ID_HEADER,
} from './cache-protocol';

/** The only entrypoint whose responses are stored by Workers Cache. */
export class DataCache extends WorkerEntrypoint<Env> {
	async fetch(request: Request): Promise<Response> {
		const executionHeaders = {
			[EXECUTION_ID_HEADER]: crypto.randomUUID(),
			[EXECUTED_AT_HEADER]: new Date().toISOString(),
		};

		if (request.headers.get(OPERATION_HEADER) !== 'set') {
			return new Response(null, {
				status: 404,
				headers: { 'Cache-Control': 'no-store', ...executionHeaders },
			});
		}

		try {
			const encodedValue = requiredHeader(request, VALUE_HEADER);
			const keyTag = validateTags([requiredHeader(request, KEY_TAG_HEADER)])[0];
			const tagsHeader = request.headers.get(TAGS_HEADER);
			const tags = validateTags(tagsHeader ? tagsHeader.split(',') : [], MAX_TAGS + 1);
			const ttl = validateTtl(Number(requiredHeader(request, TTL_HEADER)));
			const writeId = requiredHeader(request, WRITE_ID_HEADER);

			return new Response(decodeBase64(encodedValue), {
				headers: {
					'Cache-Control': `public, max-age=${ttl}, stale-if-error=0`,
					'Cache-Tag': [...tags, keyTag].join(','),
					'Content-Type': 'application/json',
					[WRITE_ID_HEADER]: writeId,
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

	async purgeTags(tags: string[]): Promise<void> {
		if (!this.ctx.cache) {
			throw new Error('Workers Cache is not enabled for DataCache');
		}

		const result = await this.ctx.cache.purge({ tags: validateTags(tags, MAX_TAGS + 1) });
		if (!result.success) {
			throw new Error(`Data cache purge failed: ${result.errors.map((error) => error.message).join(', ')}`);
		}
	}
}
