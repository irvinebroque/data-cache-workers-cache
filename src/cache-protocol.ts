export const CACHE_URL = 'https://data-cache.internal/value';
export const CACHE_KEY_PREFIX = '/__runtime-cache/v1/';
export const DEFAULT_TTL_SECONDS = 3600;
export const MAX_TAGS = 128;
export const MAX_TAG_LENGTH = 256;
export const MAX_REQUEST_HEADER_BYTES = 120 * 1024;

export const OPERATION_HEADER = 'X-Data-Cache-Operation';
export const VALUE_HEADER = 'X-Data-Cache-Value';
export const TAGS_HEADER = 'X-Data-Cache-Tags';
export const KEY_TAG_HEADER = 'X-Data-Cache-Key-Tag';
export const TTL_HEADER = 'X-Data-Cache-Ttl';
export const WRITE_ID_HEADER = 'X-Data-Cache-Write-Id';
export const EXECUTION_ID_HEADER = 'X-Data-Cache-Execution-Id';
export const EXECUTED_AT_HEADER = 'X-Data-Cache-Executed-At';

export async function cacheIdentity(key: string): Promise<{ cacheKey: string; keyTag: string }> {
	if (!key) throw new TypeError('Data cache key must not be empty');

	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
	const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return {
		cacheKey: `${CACHE_KEY_PREFIX}${hash}`,
		keyTag: `__key:${hash}`,
	};
}

export function validateTtl(ttl: number): number {
	if (!Number.isSafeInteger(ttl) || ttl <= 0) {
		throw new TypeError('Data cache ttl must be a positive integer');
	}
	return ttl;
}

export function validateTags(tags: string[], maximum = MAX_TAGS): string[] {
	if (tags.length > maximum) throw new TypeError(`Data cache accepts at most ${maximum} tags`);

	const unique = [...new Set(tags)];
	for (const tag of unique) {
		if (!tag || tag.length > MAX_TAG_LENGTH || tag.includes(',') || !/^[!-~]+$/.test(tag)) {
			throw new TypeError(`Invalid data cache tag: ${tag}`);
		}
	}
	return unique;
}

export function requiredHeader(request: Request, name: string): string {
	const value = request.headers.get(name);
	if (!value) throw new TypeError(`Missing ${name} header`);
	return value;
}

export function assertHeaderBudget(headers: Headers): void {
	let size = 0;
	headers.forEach((value, name) => {
		size += new TextEncoder().encode(`${name}: ${value}\r\n`).byteLength;
	});
	if (size > MAX_REQUEST_HEADER_BYTES) {
		throw new RangeError('Serialized data cache value is too large for the prototype');
	}
}

export function encodeBase64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
	const binary = atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
