// The built-in HDR environments (stage-hdr.js HDR_BUILTINS), drawn as
// equirectangular radiance maps in linear RGB: a night street, an overcast
// field and a photo studio. Pure arithmetic and an integer hash, so a map is
// the same on every machine and the tests read its pixels. Rows run from
// straight down (row 0) to straight up, columns around the horizon the way
// three samples an equirectangular texture: azimuth 0 is +x, +90 is +z (toward
// the default camera), -90 is -z.

const D = Math.PI / 180;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
const add = (out, colour, weight) => { if (weight > 0) for (let i = 0; i < 3; i++) out[i] += colour[i] * weight; };
/** A 0..1 integer hash of two integers and a seed: windows, rooflines and trees. */
function hash(a, b, seed) {
	let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth 0..1 value noise around the horizon: `knots` hashed values, eased between, wrapping at azimuth +-180. */
const noise = (az, knots, seed) => {
	const x = ((az + 180) / 360) * knots, i = Math.floor(x), t = smooth(x - i);
	return hash(i % knots, 0, seed) * (1 - t) + hash((i + 1) % knots, 0, seed) * t;
};
const unit = (az, el) => [Math.cos(el * D) * Math.cos(az * D), Math.sin(el * D), Math.cos(el * D) * Math.sin(az * D)];
/** A round light of peak radiance 1 at `centre`, falling to 1/e `radius` degrees off it. */
const spot = (dir, centre, radius) => Math.exp((dir[0] * centre[0] + dir[1] * centre[1] + dir[2] * centre[2] - 1) / (1 - Math.cos(radius * D)));
/** Signed azimuth difference in degrees, -180..180. */
const azDelta = (az, centre) => ((((az - centre + 180) % 360) + 360) % 360) - 180;
/** A soft-edged panel in azimuth/elevation (degrees): 1 inside, 0 outside, `edge` wide. */
const panel = (az, el, { az: a, el: e, w, h, edge = 1.5 }) => smooth((w - Math.abs(azDelta(az, a)) * Math.cos(e * D)) / edge) * smooth((h - Math.abs(el - e)) / edge);

const NIGHT = { lampA: unit(42.5, 11.6), lampB: unit(-140.5, 12.8), moon: unit(-60, 48) };
function nightStreet(az, el, dir) {
	const out = el >= 0 ? mix([0.03, 0.028, 0.042], [0.004, 0.006, 0.016], Math.sqrt(el / 90)) : [0.006, 0.006, 0.0075];
	if (el >= 0) {
		// A skyline of blocks 5..14 degrees wide and 3..16 tall, with lit windows.
		const block = Math.floor((az + 180) / 9), roof = 3 + 13 * hash(block, 1, 7) * (0.5 + 0.5 * hash(block, 2, 7));
		if (el < roof) {
			out.splice(0, 3, 0.007, 0.007, 0.01);
			const column = Math.floor((az + 180) / 1.1), row = Math.floor(el / 1.5), lit = hash(column, row, 11);
			const inside = Math.abs(((az + 180) / 1.1) % 1 - 0.5) < 0.28 && Math.abs((el / 1.5) % 1 - 0.5) < 0.24;
			if (inside && lit < 0.3) add(out, lit < 0.2 ? [0.42, 0.3, 0.15] : [0.2, 0.22, 0.28], 1);
		}
		add(out, [3.2, 3.4, 3.8], spot(dir, NIGHT.moon, 0.45));
		add(out, [0.03, 0.035, 0.05], spot(dir, NIGHT.moon, 9));
	} else {
		// Wet asphalt: a warm pool under each lamp and a streak reflecting it.
		for (const [lamp, az0] of [[NIGHT.lampA, 42.5], [NIGHT.lampB, -140.5]]) {
			const across = azDelta(az, az0), pool = Math.exp(-(across * across) / (2 * 22 * 22)) * smooth((-el - 2) / 10) * Math.exp(-Math.max(0, -el - 18) / 18);
			add(out, [0.09, 0.05, 0.018], pool);
			add(out, [0.6, 0.33, 0.1], Math.exp(-(across * across) / 4) * smooth((-el) / 2) * Math.exp(el / 10) * (lamp === NIGHT.lampA ? 1 : 0.8));
		}
	}
	add(out, [70, 38, 12], spot(dir, NIGHT.lampA, 1.3));
	add(out, [55, 30, 9.5], spot(dir, NIGHT.lampB, 1.3));
	add(out, [0.9, 0.5, 0.17], spot(dir, NIGHT.lampA, 5) + 0.8 * spot(dir, NIGHT.lampB, 5));
	return out;
}

const OVERCAST = { sun: unit(-118, 40) };
function overcastField(az, el, dir) {
	if (el < 0) {
		// A green field, hazier toward the horizon.
		const out = mix([0.13, 0.155, 0.1], [0.085, 0.125, 0.045], smooth(-el / 25));
		add(out, [0.012, 0.015, 0.004], hash(Math.floor((az + 180) * 2), Math.floor(-el * 2), 3) - 0.5);
		return out;
	}
	// The overcast sky is three times brighter overhead than at the horizon.
	const out = [0.8, 0.83, 0.88].map((value) => value * (1 + 2 * Math.sin(el * D)) / 3);
	add(out, [0.9, 0.85, 0.74], spot(dir, OVERCAST.sun, 14));
	// A tree line: two octaves of smooth value noise around the horizon, 0.5..3 degrees tall.
	const crown = 0.5 + 1.8 * noise(az, 52, 5) + 0.7 * noise(az, 225, 6);
	if (el < crown) return mix(out, [0.032, 0.046, 0.028], smooth((crown - el) / 0.25));
	return out;
}

const STUDIO = { keyCentre: unit(130.6, 23.5), key: { az: 130.6, el: 23.5, w: 16, h: 12 }, strip: { az: 13, el: 15, w: 4, h: 22 }, rim: { az: -84, el: 19, w: 10, h: 14 } };
function studioSoftbox(az, el, dir) {
	const out = el >= 0 ? [0.018, 0.018, 0.02] : mix([0.032, 0.032, 0.034], [0.022, 0.022, 0.024], smooth(-el / 60));
	// The softbox is a touch brighter at its centre, like a real diffuser.
	add(out, [5, 4.9, 4.7], panel(az, el, STUDIO.key) * (0.92 + 0.08 * spot(dir, STUDIO.keyCentre, 8)));
	add(out, [2.2, 2.3, 2.5], panel(az, el, STUDIO.strip));
	add(out, [2, 2, 2], panel(az, el, STUDIO.rim));
	add(out, [0.5, 0.5, 0.5], smooth((el - 66) / 6));
	return out;
}

const DRAW = { "builtin:night-street": nightStreet, "builtin:overcast-field": overcastField, "builtin:studio-softbox": studioSoftbox };
export const BUILTIN_WIDTH = 1024;
export const BUILTIN_HEIGHT = 512;

/** A built-in map as RGBA floats (linear radiance), or null for an unknown id. */
export function builtinEnvironmentPixels(id, width = BUILTIN_WIDTH, height = BUILTIN_HEIGHT) {
	const draw = DRAW[id];
	if (!draw) return null;
	const data = new Float32Array(width * height * 4);
	for (let row = 0; row < height; row++) {
		const el = ((row + 0.5) / height - 0.5) * 180;
		for (let column = 0; column < width; column++) {
			const az = ((column + 0.5) / width - 0.5) * 360, radiance = draw(az, el, unit(az, el));
			data.set([Math.max(0, radiance[0]), Math.max(0, radiance[1]), Math.max(0, radiance[2]), 1], (row * width + column) * 4);
		}
	}
	return data;
}
