// The image port behind sculpt.compare: a reference ({ assetId } from the asset
// store, or { dataUrl }) decoded to RGBA, and an RGBA sheet encoded as a PNG data
// URL. The editor uses the browser one below; a Node test hands in its own as
// `ports.sculptImages`, so the scoring runs on the same pixels in both.
import { getAsset, openAssetDb } from "../scene-assets.js";

function canvas(width, height) {
	if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
	if (globalThis.document?.createElement) return Object.assign(document.createElement("canvas"), { width, height });
	throw new Error("this browser cannot draw images: no canvas is available");
}

async function referenceBlob(reference) {
	if (reference.dataUrl !== undefined) return (await fetch(reference.dataUrl)).blob();
	const asset = await getAsset(await openAssetDb(), reference.assetId);
	if (!asset || asset.width === undefined) throw new Error(`no image asset ${reference.assetId} in this project`);
	return new Blob([asset.bytes], { type: asset.type });
}

export const browserSculptImages = Object.freeze({
	async decode(reference) {
		if (typeof createImageBitmap !== "function") throw new Error("this browser cannot decode images: createImageBitmap is unavailable");
		const bitmap = await createImageBitmap(await referenceBlob(reference));
		try {
			const context = canvas(bitmap.width, bitmap.height).getContext("2d", { willReadFrequently: true });
			context.drawImage(bitmap, 0, 0);
			const { width, height, data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
			return { width, height, data };
		} finally {
			bitmap.close?.();
		}
	},
	async encodePng({ width, height, data }) {
		const surface = canvas(width, height);
		surface.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height), 0, 0);
		if (!surface.convertToBlob) return surface.toDataURL("image/png");
		const bytes = new Uint8Array(await (await surface.convertToBlob({ type: "image/png" })).arrayBuffer());
		let binary = "";
		for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		return `data:image/png;base64,${btoa(binary)}`;
	},
});

/** Nearest-neighbour shrink of an RGBA image by an integer factor. */
export function shrinkRgba({ width, height, data }, factor) {
	const w = Math.max(1, Math.floor(width / factor)), h = Math.max(1, Math.floor(height / factor));
	const out = new Uint8Array(w * h * 4);
	for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
		const s = ((y * factor) * width + x * factor) * 4;
		out.set(data.subarray(s, s + 4), (y * w + x) * 4);
	}
	return { width: w, height: h, data: out };
}
