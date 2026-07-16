export const CACHE_URL = 'https://vinext-data-cache.internal/v1/entry';
export const CACHE_KEY_PREFIX = '/__vinext-data-cache/v1/';
export const MAILBOX_CACHE_NAME = 'vinext-data-cache-mailbox-v1';
export const MAILBOX_URL_PREFIX = 'https://vinext-data-cache-mailbox.internal/v1/';
export const DEFAULT_STORAGE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MAILBOX_TTL_SECONDS = 60;
export const MAX_TAGS = 232;
export const MAX_TAG_LENGTH = 1024;
export const MAX_CACHE_TAG_HEADER_BYTES = 16 * 1024;
export const MAX_RECORD_BYTES = 2 * 1024 * 1024;
export const MAX_PURGE_OPERATIONS = 100;
export const PATH_TAG_PREFIX = '_N_T_';

export const MAILBOX_HEADER = 'X-Vinext-Cache-Mailbox';
export const TAGS_HEADER = 'X-Vinext-Cache-Tags';
export const TTL_HEADER = 'X-Vinext-Cache-Ttl';
export const WRITE_ID_HEADER = 'X-Vinext-Cache-Write-Id';
export const DIGEST_HEADER = 'X-Vinext-Cache-Digest';
export const EXECUTION_ID_HEADER = 'X-Vinext-Cache-Execution-Id';
export const EXECUTED_AT_HEADER = 'X-Vinext-Cache-Executed-At';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type CacheIdentity = {
	cacheKey: string;
	keyTag: string;
};

export async function cacheIdentity(key: string, appPrefix = ''): Promise<CacheIdentity> {
	if (!key) throw new TypeError('Data cache key must not be empty');
	const hash = await hashText(`key\0${appPrefix}\0${key}`);
	return {
		cacheKey: `${CACHE_KEY_PREFIX}${hash}`,
		keyTag: `vx:k:${hash}`,
	};
}

export async function cacheTag(tag: string, appPrefix = ''): Promise<string> {
	return `vx:t:${await hashText(`tag\0${appPrefix}\0${tag}`)}`;
}

export async function cacheNamespaceTag(appPrefix = ''): Promise<string> {
	return `vx:data:${await hashText(`app\0${appPrefix}`)}`;
}

export function mailboxRequest(nonce: string): Request {
	if (!UUID_PATTERN.test(nonce)) throw new TypeError('Invalid data cache mailbox nonce');
	return new Request(`${MAILBOX_URL_PREFIX}${nonce}`);
}

export function validateTtl(ttl: number): number {
	if (!Number.isSafeInteger(ttl) || ttl <= 0) {
		throw new TypeError('Data cache ttl must be a positive integer');
	}
	return ttl;
}

export function validateTags(tags: string[], maximum = MAX_TAGS): string[] {
	const unique = [...new Set(tags)];
	if (unique.length > maximum) throw new TypeError(`Data cache accepts at most ${maximum} tags`);
	for (const tag of unique) {
		if (!tag || tag.length > MAX_TAG_LENGTH) throw new TypeError('Data cache tags must contain 1-1024 characters');
	}
	return unique;
}

export function validateCloudflareTags(tags: string[]): string[] {
	const unique = [...new Set(tags)];
	if (unique.length > MAX_TAGS + 2) throw new TypeError(`Data cache accepts at most ${MAX_TAGS} logical tags`);
	for (const tag of unique) {
		if (!/^[!-~]+$/.test(tag) || tag.includes(',') || tag.length > MAX_TAG_LENGTH) {
			throw new TypeError('Invalid Workers Cache tag');
		}
	}
	return unique;
}

export function validateCacheHeaderTags(tags: string[]): string[] {
	const validated = validateCloudflareTags(tags);
	const headerBytes = validated.reduce((total, tag, index) => total + tag.length + (index > 0 ? 1 : 0), 0);
	if (headerBytes > MAX_CACHE_TAG_HEADER_BYTES) {
		throw new TypeError(`Data cache Cache-Tag header exceeds ${MAX_CACHE_TAG_HEADER_BYTES} bytes`);
	}
	return validated;
}

export function requiredHeader(headers: Headers, name: string): string {
	const value = headers.get(name);
	if (!value) throw new TypeError(`Missing ${name} header`);
	return value;
}

export function validateWriteId(value: string): string {
	if (!UUID_PATTERN.test(value)) throw new TypeError('Invalid data cache write ID');
	return value;
}

export function validateDigest(value: string): string {
	if (!SHA256_PATTERN.test(value)) throw new TypeError('Invalid data cache digest');
	return value;
}

async function hashText(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return hex(digest);
}

export function hex(value: ArrayBuffer): string {
	return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
