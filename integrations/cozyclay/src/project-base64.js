export function asArrayBuffer(bytes) {
	if (bytes instanceof ArrayBuffer) return bytes;
	if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	return null;
}

export function bytesToBase64(bytes) {
	const view = new Uint8Array(bytes);
	let binary = "";
	for (let offset = 0; offset < view.length; offset += 0x8000) {
		binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

/**
 * Structural check of a base64 payload without decoding it: character set,
 * padding, and the byte length the string implies. Returns `{ bytes }` or
 * `{ code }` with a problem code.
 */
function base64Shape(value, limit) {
	if (typeof value !== "string" || value.length < 4 || value.length % 4) return { code: "bad-base64" };
	if (value.length > Math.ceil(limit / 3) * 4) return { code: "too-large" };
	const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
	for (let index = 0; index < value.length - padding; index += 1) {
		const code = value.charCodeAt(index);
		const base64Character = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47;
		if (!base64Character) return { code: "bad-base64" };
	}
	const bytes = (value.length / 4) * 3 - padding;
	return bytes > limit ? { code: "too-large" } : { bytes };
}

/** Decode a base64 payload. Returns `{ buffer }` or `{ code }`. */
export function base64ToBytes(value, limit) {
	const shape = base64Shape(value, limit);
	if (shape.code) return shape;
	try {
		const binary = atob(value);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		// Only the canonical encoding is accepted so a payload has one spelling.
		if (bytesToBase64(bytes) !== value) return { code: "bad-base64" };
		return { buffer: bytes.buffer };
	} catch {
		return { code: "bad-base64" };
	}
}
