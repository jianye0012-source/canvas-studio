/**
 * The `object.effect` record: an emitter of smoke, fire, rain or a motion
 * trail. Pure data and clamps, shared by the object store, the agent schema
 * and the simulation (src/effects/simulate.js).
 *
 * A preset fills every field, and explicit fields override it. The record
 * stores the MERGED numbers, so a readback shows exactly what is drawn.
 * Units: metres, seconds, m/s, m/s² (+ gravity falls).
 */
import { normalizeObjectColor } from "../object-colors.js";

export const EFFECT_KIND = "effect";

/** Zero size on purpose, like an Empty: an effect is never a blocker, a
 * support or a collision box; only its particles are seen. */
export const EFFECT_ENTRY = { kind: EFFECT_KIND, label: "Effect", group: "Effects", footprint: { width: 0, depth: 0 }, height: 0, color: "#7fd4f0" };

const vec = (x, y, z) => ({ x, y, z });
const ZERO = vec(0, 0, 0);

/**
 * Each preset at its natural scale. Smoke is a cigarette's: a 12 mm wisp that
 * rises ~0.45 m over ~2.8 s while it widens 7x. Fire is a small campfire
 * (~0.4 m of flame); scale size/area/life down for a lighter.
 */
export const EFFECT_PRESETS = Object.freeze({
	smoke: { rate: 60, life: 2.8, size: 0.012, grow: 6, speed: 0.05, spread: 0.1, gravity: -0.3, wind: vec(0.02, 0, 0), color: "#7d8a99", opacity: 0.42, additive: false, area: ZERO, width: 0 },
	exhale: { rate: 120, life: 2.4, size: 0.035, grow: 8, speed: 0.9, spread: 0.35, gravity: -0.35, wind: vec(0.02, 0, 0), color: "#a3abb4", opacity: 0.3, additive: false, area: vec(0.01, 0, 0.01), width: 0 },
	steam: { rate: 26, life: 2, size: 0.03, grow: 4, speed: 0.1, spread: 0.2, gravity: -0.45, wind: vec(0.02, 0, 0), color: "#bcc5ce", opacity: 0.2, additive: false, area: vec(0.07, 0, 0.07), width: 0 },
	fire: { rate: 140, life: 0.75, size: 0.12, grow: 0.3, speed: 0.4, spread: 0.15, gravity: -2.2, wind: ZERO, color: "#ff7a1f", opacity: 1, additive: true, area: vec(0.22, 0, 0.22), width: 0 },
	sparks: { rate: 40, life: 1, size: 0.012, grow: 0.6, speed: 2.6, spread: 0.55, gravity: 6, wind: ZERO, color: "#ff9d33", opacity: 1, additive: true, area: vec(0.05, 0, 0.05), width: 0 },
	dust: { rate: 30, life: 7, size: 0.014, grow: 1.2, speed: 0, spread: 1, gravity: 0.01, wind: vec(0.04, 0, 0.01), color: "#a89a82", opacity: 0.55, additive: false, area: vec(3, 2.2, 3), width: 0 },
	rain: { rate: 1600, life: 1.2, size: 0.01, grow: 1, speed: 0, spread: 0, gravity: 9.8, wind: ZERO, color: "#9aabbd", opacity: 0.4, additive: false, area: vec(8, 5, 8), width: 0 },
	snow: { rate: 220, life: 8, size: 0.025, grow: 1, speed: 0, spread: 0, gravity: 9.8, wind: vec(0.1, 0, 0), color: "#ffffff", opacity: 0.85, additive: false, area: vec(8, 4, 8), width: 0 },
	trail: { rate: 0, life: 0.3, size: 0, grow: 1, speed: 0, spread: 0, gravity: 0, wind: ZERO, color: "#a7b8ca", opacity: 0.75, additive: false, area: ZERO, width: 0.5 },
});
const EFFECT_PRESET_NAMES = Object.freeze(Object.keys(EFFECT_PRESETS));

const LIMITS = { rate: [0, 2000], life: [0.05, 12], size: [0.001, 5], grow: [0.05, 20], speed: [0, 60], spread: [0, 1], gravity: [-30, 30], opacity: [0, 1], width: [0, 10] };
const VEC_LIMITS = { wind: [-20, 20], area: [0, 100] };
const SEED_MAX = 2147483647;

const clampTo = ([min, max], value, fallback) => {
	const n = Number(value);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** The stored effect: `value`'s preset filled in, its explicit fields clamped over it. */
export function normalizeEffect(value) {
	const given = value && typeof value === "object" && !Array.isArray(value) ? value : {};
	const preset = EFFECT_PRESET_NAMES.includes(given.preset) ? given.preset : "smoke";
	const base = EFFECT_PRESETS[preset];
	const out = { preset };
	for (const [key, range] of Object.entries(LIMITS)) out[key] = clampTo(range, given[key], base[key]);
	for (const [key, range] of Object.entries(VEC_LIMITS)) {
		const v = given[key] && typeof given[key] === "object" ? given[key] : {};
		out[key] = vec(...["x", "y", "z"].map((axis) => clampTo(range, v[axis], base[key][axis])));
	}
	out.color = normalizeObjectColor(given.color) ?? base.color;
	out.additive = typeof given.additive === "boolean" ? given.additive : base.additive;
	const seed = Number(given.seed);
	out.seed = Number.isFinite(seed) ? Math.min(SEED_MAX, Math.max(0, Math.round(seed))) : 1;
	return out;
}

/** The record fields an effect carries (none for any other renderer): one
 * spread in normalizeSceneObject and createSceneObject. */
export function effectFields(record) {
	return record?.renderer === EFFECT_KIND ? { effect: normalizeEffect(record.effect) } : {};
}

/**
 * An `object.set` op with a NEW preset gets that preset's defaults written
 * out, so the set merges onto the preset rather than onto the old preset's
 * numbers: { preset: "fire" } on a smoke emitter becomes fire, and
 * { preset: "fire", rate: 40 } is fire at 40/s. Any other op is returned as is.
 */
export function effectPresetSet(op, objects) {
	const preset = op?.set?.effect?.preset;
	if (!EFFECT_PRESET_NAMES.includes(preset)) return op;
	const current = objects?.find?.((object) => object.id === op.id)?.effect;
	if (current?.preset === preset) return op;
	const defaults = structuredClone(EFFECT_PRESETS[preset]);
	return { ...op, set: { ...op.set, effect: { ...defaults, seed: current?.seed ?? 1, ...op.set.effect } } };
}

const num = (minimum, maximum) => ({ type: "number", minimum, maximum });
const vecSchema = ([min, max]) => ({ type: "object", properties: { x: num(min, max), y: num(min, max), z: num(min, max) }, required: [], additionalProperties: false });

/** The wire shape of `object.effect` for object.set / patch_elements (every member optional). */
export const EFFECT_VALUE_SCHEMA = Object.freeze({
	type: "object",
	properties: {
		preset: { type: "string", enum: [...EFFECT_PRESET_NAMES] },
		...Object.fromEntries(Object.entries(LIMITS).map(([key, [min, max]]) => [key, num(min, max)])),
		...Object.fromEntries(Object.entries(VEC_LIMITS).map(([key, range]) => [key, vecSchema(range)])),
		color: { type: "string", minLength: 1, maxLength: 32, pattern: "^#[0-9a-fA-F]{6}$" },
		additive: { type: "boolean" },
		seed: { type: "integer", minimum: 0, maximum: SEED_MAX },
	},
	required: [],
	additionalProperties: false,
});
