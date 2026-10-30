// Environment files to the half-float equirectangular maps the stage renders
// (stage-hdr-map.js): a Radiance .hdr through three's HDRLoader (the r180+ name
// of RGBELoader), an OpenEXR through EXRLoader (loaded on first use), and an LDR
// .png / .jpg through the browser's own decoder. Every map comes out the same
// way: RGBA half floats in linear light, rows from straight down (row 0) to
// straight up, at most HDR_MAX_WIDTH wide (a box filter by a whole factor), plus
// its horizon colour (the deck fades into it) and its brightest direction (the
// agent aims hdrRotation with it). No DOM at import, so Node tests decode too.
import { DataUtils } from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

/** Widest map kept: the background's sharpness against the GPU memory of its cube and PMREM. */
export const HDR_MAX_WIDTH = 2048;
const fromHalf = DataUtils.fromHalfFloat;
const toHalf = DataUtils.toHalfFloat;

/** RGBA floats (rows bottom-up) as a half-float map. */
export function halfMapFromFloats(width, height, floats) {
	const data = new Uint16Array(floats.length);
	for (let i = 0; i < floats.length; i++) data[i] = toHalf(floats[i]);
	return { width, height, data };
}

/**
 * A decoded image as a map: rows flipped bottom-up when the source runs top-down,
 * and box-filtered by the smallest whole factor that fits maxWidth.
 */
export function fitMap({ width, height, data, topDown = false }, maxWidth = HDR_MAX_WIDTH) {
	const factor = Math.max(1, Math.ceil(width / maxWidth));
	if (factor === 1 && !topDown) return { width, height, data };
	const w = Math.floor(width / factor), h = Math.max(1, Math.floor(height / factor)), out = new Uint16Array(w * h * 4);
	const sourceRow = (row) => (topDown ? height - 1 - row : row);
	if (factor === 1) {
		for (let row = 0; row < h; row++) out.set(data.subarray(sourceRow(row) * width * 4, (sourceRow(row) + 1) * width * 4), row * width * 4);
		return { width: w, height: h, data: out };
	}
	const sum = new Float64Array(4), area = factor * factor;
	for (let row = 0; row < h; row++) {
		for (let column = 0; column < w; column++) {
			sum.fill(0);
			for (let dy = 0; dy < factor; dy++) {
				const base = (sourceRow(row * factor + dy) * width + column * factor) * 4;
				for (let i = 0; i < factor * 4; i++) sum[i & 3] += fromHalf(data[base + i]);
			}
			for (let channel = 0; channel < 4; channel++) out[(row * w + column) * 4 + channel] = toHalf(sum[channel] / area);
		}
	}
	return { width: w, height: h, data: out };
}

/** Mean linear RGB of the band within 3 degrees of the horizon. */
export function mapHorizon({ width, height, data }) {
	const band = Math.max(1, Math.round((3 / 180) * height)), first = Math.max(0, Math.floor(height / 2) - band), last = Math.min(height, Math.ceil(height / 2) + band);
	const sum = [0, 0, 0];
	for (let row = first; row < last; row++) for (let i = row * width * 4; i < (row + 1) * width * 4; i += 4) for (let c = 0; c < 3; c++) sum[c] += fromHalf(data[i + c]);
	return sum.map((value) => Number((value / ((last - first) * width)).toFixed(5)));
}

/**
 * World direction [x, y, z] of the map's brightest light (y up, azimuth 0 = +x,
 * 90 = +z), rounded: the solid-angle-weighted mean direction of every texel
 * within 10% of the peak, so a flat sun disc or a softbox reads at its centre.
 */
export function mapBrightest({ width, height, data }) {
	const luma = new Float32Array(width * height);
	let peak = 0;
	for (let i = 0; i < luma.length; i++) peak = Math.max(peak, (luma[i] = 0.2126 * fromHalf(data[i * 4]) + 0.7152 * fromHalf(data[i * 4 + 1]) + 0.0722 * fromHalf(data[i * 4 + 2])));
	const sum = [0, 0, 0];
	for (let i = 0; i < luma.length; i++) {
		if (luma[i] < 0.9 * peak) continue;
		const az = (((i % width) + 0.5) / width - 0.5) * 2 * Math.PI, el = ((Math.floor(i / width) + 0.5) / height - 0.5) * Math.PI, cos = Math.cos(el);
		sum[0] += cos * cos * Math.cos(az);
		sum[1] += cos * Math.sin(el);
		sum[2] += cos * cos * Math.sin(az);
	}
	const length = Math.hypot(...sum) || 1;
	return sum.map((value) => Number((value / length).toFixed(2)) || 0);
}

/** A map with its analysis, as the map cache stores it. */
export const analyzedMap = (map) => ({ ...map, horizon: mapHorizon(map), brightest: mapBrightest(map) });

/** A Radiance RGBE file (ArrayBuffer) as a fitted map. Throws on a malformed file. */
export function decodeRadiance(buffer) {
	const { width, height, data } = new HDRLoader().parse(buffer);
	return analyzedMap(fitMap({ width, height, data, topDown: true }));
}

async function decodeExr(buffer) {
	const { EXRLoader } = await import("three/examples/jsm/loaders/EXRLoader.js");
	const { width, height, data } = new EXRLoader().parse(buffer);
	return analyzedMap(fitMap({ width, height, data }));
}

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, i) => { const c = i / 255; return toHalf(c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); });
/** An LDR equirectangular picture through the browser's decoder, scaled to fit, in linear light. */
async function decodePicture(buffer, type) {
	const bitmap = await createImageBitmap(new Blob([buffer], { type }));
	try {
		const width = Math.min(HDR_MAX_WIDTH, bitmap.width), height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
		const canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d");
		context.drawImage(bitmap, 0, 0, width, height);
		const pixels = context.getImageData(0, 0, width, height).data, data = new Uint16Array(pixels.length);
		for (let i = 0; i < pixels.length; i++) data[i] = (i & 3) === 3 ? toHalf(1) : SRGB_TO_LINEAR[pixels[i]];
		return analyzedMap(fitMap({ width, height, data, topDown: true }));
	} finally {
		bitmap.close?.();
	}
}

/** A stored environment record (stage-hdr.js normalizeHdrAsset) decoded to a map with its analysis. */
export function decodeEnvironment({ type, bytes }) {
	if (type === "image/vnd.radiance") return Promise.resolve().then(() => decodeRadiance(bytes));
	if (type === "image/x-exr") return decodeExr(bytes);
	return decodePicture(bytes, type);
}
