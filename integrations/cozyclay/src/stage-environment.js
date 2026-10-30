// The stage look's environment light (stage.lighting.envLight): a sky-and-ground
// map built from the look's own colours, so clay and kit materials take the sky's
// tint and a soft fill from every direction instead of a flat two-colour
// hemisphere. The upper half grades from `sky` at the horizon to `skyTop`
// overhead (the same easing as the background, stage-sky.jsx), the lower half is
// the ground bounce (hemiGround), and a glow sits around the key's direction (the
// sun, the moon). Pure arithmetic in linear RGB, so the tests read the pixels;
// stage-sky.jsx prefilters the map with PMREMGenerator and sets it as
// scene.environment.
//
// Brightness: the sky half is scaled to carry the hemisphere's sky light (hemiSky)
// in total, and stageLook() hands the hemisphere's
// share to the map as envLight rises (0 = hemisphere only, the studio look;
// 1 = the map alone at the same level; 2 = twice as bright).

export const ENV_WIDTH = 128;
export const ENV_HEIGHT = 64;
// How much the key's glow adds under crisp shadows, as a share of the sky's own
// light on a surface facing it, and its spread (1 - cos of the angle where it falls to 1/e, ~24 deg).
const SUN_SHARE = 0.8;
const SUN_SPREAD = 0.085;
// Below the horizon the ground takes over across this band (degrees).
const HORIZON_BAND = 8;

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** "#rrggbb" to linear RGB 0..1. */
export const linearRgb = (hex) => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
export const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);
const scale = (a, k) => a.map((value) => value * k);
const round = (a) => a.map((value) => Number(value.toFixed(5)));

// The sky's easing by elevation (degrees): 0 at and below the horizon, 1 from 60 deg up.
const skyBlend = (elevation) => (elevation <= 0 ? 0 : 1 - (1 - Math.min(1, elevation / 60)) ** 2);

/**
 * What the map is made of, in linear RGB, or null when envLight is 0. `lighting`
 * and `keyLight` are normalized (stage-lighting.js); `sky` is the horizon colour
 * the look resolved (the theme grey when lighting.sky is null).
 */
export function environmentSpec(lighting, keyLight, sky) {
	if (!(lighting.envLight > 0)) return null;
	const horizon = linearRgb(sky), zenith = linearRgb(lighting.skyTop ?? sky), skyLight = linearRgb(lighting.hemiSky);
	// The sky half's mean luminance over its solid angle, so the sky can be scaled
	// to carry hemiSky's light in total whatever its colours: a sky brighter at the
	// horizon then lights the sides of a figure more and its top less.
	let weighted = 0, weights = 0;
	for (let step = 0; step < 90; step++) {
		const elevation = step + 0.5, cos = Math.cos((elevation * Math.PI) / 180);
		weighted += luminance(mix(horizon, zenith, skyBlend(elevation))) * cos;
		weights += cos;
	}
	const mean = weighted / weights, target = luminance(skyLight);
	// A black sky has no shape to keep: the sky half is then hemiSky itself.
	const [low, high] = mean > 1e-6 ? [scale(horizon, target / mean), scale(zenith, target / mean)] : [skyLight, skyLight];
	const length = Math.hypot(keyLight.x, keyLight.y, keyLight.z) || 1, key = linearRgb(keyLight.color ?? "#ffffff");
	// A soft-shadowed look is a hazy or overcast sky: its sun is a fainter glow.
	const keyLuma = luminance(key) || 1, share = SUN_SHARE * (1 - 0.6 * lighting.shadowSoftness);
	return {
		horizon: round(low), zenith: round(high), ground: round(linearRgb(lighting.hemiGround)),
		sun: { direction: round([keyLight.x / length, keyLight.y / length, keyLight.z / length]),
			// peak radiance: the glow integrates to ~2*pi*spread, so this adds `share` of the sky's light toward it
			color: round(scale(key, (share * target) / (2 * SUN_SPREAD) / keyLuma)) },
	};
}

/** Radiance (linear RGB) of the map in a unit direction [x, y, z] (y up). */
export function environmentRadiance(spec, [x, y, z]) {
	const elevation = (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;
	const skyAt = mix(spec.horizon, spec.zenith, skyBlend(elevation));
	const base = elevation >= 0 ? skyAt : mix(spec.horizon, spec.ground, Math.min(1, -elevation / HORIZON_BAND));
	const [sx, sy, sz] = spec.sun.direction, cos = x * sx + y * sy + z * sz;
	const glow = Math.exp((cos - 1) / SUN_SPREAD);
	return base.map((value, i) => value + spec.sun.color[i] * glow);
}

/**
 * The equirectangular map as RGBA floats, rows from straight down (row 0) to
 * straight up, columns around the horizon the way three samples an
 * equirectangular texture (u = atan2(z, x) / 2pi + 0.5).
 */
export function environmentPixels(spec, width = ENV_WIDTH, height = ENV_HEIGHT) {
	const data = new Float32Array(width * height * 4);
	for (let row = 0; row < height; row++) {
		const elevation = ((row + 0.5) / height - 0.5) * Math.PI, cosEl = Math.cos(elevation), y = Math.sin(elevation);
		for (let column = 0; column < width; column++) {
			const azimuth = ((column + 0.5) / width - 0.5) * 2 * Math.PI;
			const radiance = environmentRadiance(spec, [Math.cos(azimuth) * cosEl, y, Math.sin(azimuth) * cosEl]);
			data.set([...radiance, 1], (row * width + column) * 4);
		}
	}
	return data;
}
