import { hex, MAX_RECORD_BYTES } from './cache-protocol';
import type { CacheRecord, IncrementalCacheValue } from './cache-types';

const MAGIC = new Uint8Array([0x56, 0x58, 0x57, 0x43]); // VXWC
const VERSION = 1;
const HEADER_BYTES = MAGIC.byteLength + 1 + 4;

type FrameField = 'rscData' | 'body' | 'buffer';

type Frame = {
	field: FrameField;
	offset: number;
	length: number;
};

type WireRecord = Omit<CacheRecord, 'value'> & {
	schema: 1;
	value: { data: unknown; frames: Frame[] } | null;
};

export function encodeCacheRecord(record: CacheRecord): ArrayBuffer {
	const frames: ArrayBuffer[] = [];
	let data: unknown = record.value;

	if (record.value?.kind === 'APP_PAGE') {
		const { rscData, ...rest } = record.value;
		data = rest;
		if (rscData) frames.push(rscData);
	} else if (record.value?.kind === 'APP_ROUTE') {
		const { body, ...rest } = record.value;
		data = rest;
		frames.push(body);
	} else if (record.value?.kind === 'IMAGE') {
		const { buffer, ...rest } = record.value;
		data = rest;
		frames.push(buffer);
	}

	let offset = 0;
	const frameMetadata = frames.map((frame, index): Frame => {
		const field: FrameField =
			record.value?.kind === 'APP_PAGE' ? 'rscData' : record.value?.kind === 'APP_ROUTE' ? 'body' : 'buffer';
		const metadata = { field, offset, length: frame.byteLength };
		offset += frame.byteLength;
		if (record.value?.kind === 'APP_PAGE' && index > 0) throw new Error('Unexpected APP_PAGE frame');
		return metadata;
	});

	const wire: WireRecord = {
		schema: VERSION,
		lastModified: record.lastModified,
		revalidateAt: record.revalidateAt,
		expireAt: record.expireAt,
		cacheControl: record.cacheControl,
		tags: record.tags,
		value: record.value === null ? null : { data, frames: frameMetadata },
	};
	assertJsonWithinLimit(wire, MAX_RECORD_BYTES - HEADER_BYTES - offset);
	const metadata = new TextEncoder().encode(JSON.stringify(wire));
	const total = HEADER_BYTES + metadata.byteLength + offset;
	if (total > MAX_RECORD_BYTES) throw new RangeError(`Data cache record exceeds ${MAX_RECORD_BYTES} bytes`);

	const output = new Uint8Array(total);
	output.set(MAGIC, 0);
	output[MAGIC.byteLength] = VERSION;
	new DataView(output.buffer).setUint32(MAGIC.byteLength + 1, metadata.byteLength);
	output.set(metadata, HEADER_BYTES);

	let frameOffset = HEADER_BYTES + metadata.byteLength;
	for (const frame of frames) {
		output.set(new Uint8Array(frame), frameOffset);
		frameOffset += frame.byteLength;
	}
	return output.buffer;
}

export function decodeCacheRecord(encoded: ArrayBuffer): CacheRecord {
	if (encoded.byteLength < HEADER_BYTES || encoded.byteLength > MAX_RECORD_BYTES) {
		throw new Error('Invalid data cache record size');
	}

	const bytes = new Uint8Array(encoded);
	for (let index = 0; index < MAGIC.byteLength; index++) {
		if (bytes[index] !== MAGIC[index]) throw new Error('Invalid data cache record magic');
	}
	if (bytes[MAGIC.byteLength] !== VERSION) throw new Error('Unsupported data cache record version');

	const metadataLength = new DataView(encoded).getUint32(MAGIC.byteLength + 1);
	const bodyOffset = HEADER_BYTES + metadataLength;
	if (bodyOffset > bytes.byteLength) throw new Error('Invalid data cache record metadata length');

	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER_BYTES, bodyOffset)));
	} catch {
		throw new Error('Invalid data cache record metadata');
	}
	const wire = validateWireRecord(parsed, bytes.byteLength - bodyOffset);

	return {
		lastModified: wire.lastModified,
		revalidateAt: wire.revalidateAt,
		expireAt: wire.expireAt,
		cacheControl: wire.cacheControl,
		tags: wire.tags,
		value: restoreValue(wire.value, bytes, bodyOffset),
	};
}

export async function cacheRecordDigest(encoded: ArrayBuffer): Promise<string> {
	return hex(await crypto.subtle.digest('SHA-256', encoded));
}

export async function readBoundedResponseBody(
	response: Response,
	maximum = MAX_RECORD_BYTES,
): Promise<ArrayBuffer> {
	const contentLength = response.headers.get('Content-Length');
	if (contentLength !== null) {
		const declaredLength = Number(contentLength);
		if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > maximum) {
			throw new RangeError(`Data cache record exceeds ${maximum} bytes`);
		}
	}
	if (!response.body) return new ArrayBuffer(0);

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	let completed = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			byteLength += value.byteLength;
			if (byteLength > maximum) throw new RangeError(`Data cache record exceeds ${maximum} bytes`);
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

	const output = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output.buffer;
}

function validateWireRecord(value: unknown, frameBytes: number): WireRecord {
	if (!isRecord(value) || value.schema !== VERSION) throw new Error('Invalid data cache record');
	if (!isFiniteNumber(value.lastModified) || value.lastModified < 0) throw new Error('Invalid lastModified');
	if (!isNullableNumber(value.revalidateAt) || !isNullableNumber(value.expireAt)) throw new Error('Invalid cache timing');
	if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === 'string')) throw new Error('Invalid cache tags');
	if (value.cacheControl !== undefined && !isCacheControl(value.cacheControl)) throw new Error('Invalid cache control');

	if (value.value !== null) {
		if (!isRecord(value.value) || !Array.isArray(value.value.frames)) throw new Error('Invalid cache value');
		for (const frame of value.value.frames) validateFrame(frame, frameBytes);
	}
	return value as WireRecord;
}

function restoreValue(value: WireRecord['value'], bytes: Uint8Array, bodyOffset: number): IncrementalCacheValue | null {
	if (value === null) return null;
	if (!isRecord(value.data) || typeof value.data.kind !== 'string') throw new Error('Invalid incremental cache value');
	validateIncrementalMetadata(value.data);

	const frame = (field: FrameField, required: boolean): ArrayBuffer | undefined => {
		const matches = value.frames.filter((candidate) => candidate.field === field);
		if (matches.length > 1 || (required && matches.length !== 1)) throw new Error(`Invalid ${field} frame`);
		if (matches.length === 0) return undefined;
		const match = matches[0];
		return bytes.slice(bodyOffset + match.offset, bodyOffset + match.offset + match.length).buffer;
	};

	switch (value.data.kind) {
		case 'APP_PAGE':
			assertOnlyFrames(value.frames, 'rscData');
			return { ...value.data, rscData: frame('rscData', false) } as IncrementalCacheValue;
		case 'APP_ROUTE':
			assertOnlyFrames(value.frames, 'body');
			return { ...value.data, body: frame('body', true) } as IncrementalCacheValue;
		case 'IMAGE':
			assertOnlyFrames(value.frames, 'buffer');
			return { ...value.data, buffer: frame('buffer', true) } as IncrementalCacheValue;
		case 'FETCH':
		case 'PAGES':
		case 'REDIRECT':
			if (value.frames.length !== 0) throw new Error('Unexpected data cache frames');
			return value.data as IncrementalCacheValue;
		default:
			throw new Error(`Unsupported incremental cache value: ${value.data.kind}`);
	}
}

function validateIncrementalMetadata(value: Record<string, unknown>): void {
	switch (value.kind) {
		case 'FETCH':
			if (
				!isRecord(value.data) ||
				!isStringRecord(value.data.headers) ||
				typeof value.data.body !== 'string' ||
				typeof value.data.url !== 'string' ||
				(value.data.status !== undefined && !isFiniteNumber(value.data.status)) ||
				(value.tags !== undefined && !isStringArray(value.tags)) ||
				(value.revalidate !== false && !isFiniteNumber(value.revalidate))
			) {
				throw new Error('Invalid FETCH cache value');
			}
			return;
		case 'APP_PAGE':
			if (
				typeof value.html !== 'string' ||
				(value.headers !== undefined && !isHeaderRecord(value.headers)) ||
				(value.postponed !== undefined && typeof value.postponed !== 'string') ||
				(value.renderObservation !== undefined && !isRecord(value.renderObservation)) ||
				(value.status !== undefined && !isFiniteNumber(value.status))
			) {
				throw new Error('Invalid APP_PAGE cache value');
			}
			return;
		case 'PAGES':
			if (
				typeof value.html !== 'string' ||
				!isObject(value.pageData) ||
				(value.generatedFromDataRequest !== undefined && typeof value.generatedFromDataRequest !== 'boolean') ||
				(value.headers !== undefined && !isHeaderRecord(value.headers)) ||
				(value.status !== undefined && !isFiniteNumber(value.status))
			) {
				throw new Error('Invalid PAGES cache value');
			}
			return;
		case 'APP_ROUTE':
			if (!isFiniteNumber(value.status) || !isHeaderRecord(value.headers)) {
				throw new Error('Invalid APP_ROUTE cache value');
			}
			return;
		case 'REDIRECT':
			if (!isObject(value.props)) throw new Error('Invalid REDIRECT cache value');
			return;
		case 'IMAGE':
			if (
				typeof value.etag !== 'string' ||
				typeof value.extension !== 'string' ||
				(value.revalidate !== undefined && !isFiniteNumber(value.revalidate))
			) {
				throw new Error('Invalid IMAGE cache value');
			}
			return;
		default:
			throw new Error(`Unsupported incremental cache value: ${String(value.kind)}`);
	}
}

function validateFrame(value: unknown, available: number): asserts value is Frame {
	if (!isRecord(value) || (value.field !== 'rscData' && value.field !== 'body' && value.field !== 'buffer')) {
		throw new Error('Invalid data cache frame');
	}
	if (!Number.isSafeInteger(value.offset) || !Number.isSafeInteger(value.length)) throw new Error('Invalid data cache frame bounds');
	if ((value.offset as number) < 0 || (value.length as number) < 0 || (value.offset as number) + (value.length as number) > available) {
		throw new Error('Data cache frame exceeds record');
	}
}

function assertOnlyFrames(frames: Frame[], field: FrameField): void {
	if (frames.some((frame) => frame.field !== field)) throw new Error('Unexpected data cache frame');
}

function isCacheControl(value: unknown): value is { revalidate: number; expire?: number } {
	return (
		isRecord(value) &&
		isFiniteNumber(value.revalidate) &&
		(value.expire === undefined || isFiniteNumber(value.expire))
	);
}

function isNullableNumber(value: unknown): value is number | null {
	return value === null || isFiniteNumber(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isHeaderRecord(value: unknown): value is Record<string, string | string[]> {
	return (
		isRecord(value) &&
		Object.values(value).every(
			(item) => typeof item === 'string' || (Array.isArray(item) && item.every((entry) => typeof entry === 'string')),
		)
	);
}

function isObject(value: unknown): value is object {
	return typeof value === 'object' && value !== null;
}

function assertJsonWithinLimit(value: unknown, maximum: number): void {
	estimateJsonBytes(value, new Set(), maximum, 0);
}

function estimateJsonBytes(value: unknown, ancestors: Set<object>, maximum: number, depth: number): number {
	if (depth > 100) throw new RangeError('Data cache metadata exceeds the maximum nesting depth');
	if (value === null) return checkedSize(4, maximum);

	switch (typeof value) {
		case 'string':
			return jsonStringBytes(value, maximum);
		case 'boolean':
			return checkedSize(value ? 4 : 5, maximum);
		case 'number':
			return checkedSize(Number.isFinite(value) ? String(value).length : 4, maximum);
		case 'bigint':
			throw new TypeError('Data cache metadata must not contain bigint values');
		case 'undefined':
		case 'function':
		case 'symbol':
			return 0;
		case 'object':
			break;
	}

	if (ancestors.has(value)) throw new TypeError('Data cache metadata must not contain circular references');
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
		throw new TypeError('Data cache metadata must contain only plain JSON values');
	}

	ancestors.add(value);
	let total = 2;
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++) {
			if (index > 0) total = checkedSize(total + 1, maximum);
			const item = value[index];
			const itemBytes =
				item === undefined || typeof item === 'function' || typeof item === 'symbol'
					? 4
					: estimateJsonBytes(item, ancestors, maximum - total, depth + 1);
			total = checkedSize(total + itemBytes, maximum);
		}
	} else {
		let propertyCount = 0;
		for (const [key, item] of Object.entries(value)) {
			if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
			if (propertyCount > 0) total = checkedSize(total + 1, maximum);
			total = checkedSize(total + jsonStringBytes(key, maximum - total) + 1, maximum);
			total = checkedSize(total + estimateJsonBytes(item, ancestors, maximum - total, depth + 1), maximum);
			propertyCount++;
		}
	}
	ancestors.delete(value);
	return total;
}

function jsonStringBytes(value: string, maximum: number): number {
	let bytes = 2;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
			bytes += 2;
		} else if (code < 0x20) {
			bytes += 6;
		} else if (code < 0x80) {
			bytes++;
		} else if (code < 0x800) {
			bytes += 2;
		} else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
			const low = value.charCodeAt(index + 1);
			if (low >= 0xdc00 && low <= 0xdfff) {
				bytes += 4;
				index++;
			} else {
				bytes += 6;
			}
		} else if (code >= 0xd800 && code <= 0xdfff) {
			bytes += 6;
		} else {
			bytes += 3;
		}
		checkedSize(bytes, maximum);
	}
	return bytes;
}

function checkedSize(size: number, maximum: number): number {
	if (size > maximum) throw new RangeError(`Data cache record exceeds ${MAX_RECORD_BYTES} bytes`);
	return size;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
