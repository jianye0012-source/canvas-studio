// Onion-skin ghosts: translucent poses of the active character's take before and after the
// playhead, an editor overlay (ghost-set.js draws them on GIZMO_LAYER). This module holds the
// viewer setting (transient like the View menu: never saved, never undone) and the pure choices:
// which frames get a ghost and how each one looks.
import { useSyncExternalStore } from "react";
import { expandUse } from "./motion3/skills/index.js";
import { skeletonFor } from "./motion3/rigs/index.js";
import { motionScene } from "./motion3/scene.js";

/** off; step: every `step` frames; keys: the take spec's key frames nearest the playhead. */
export const GHOST_MODES = Object.freeze(["off", "step", "keys"]);
export const GHOST_COUNT = Object.freeze({ min: 1, max: 6 });
export const GHOST_STEP = Object.freeze({ min: 1, max: 24 });
const GHOST_DEFAULTS = Object.freeze({ mode: "off", count: 3, step: 4 });
/** Past poses cool, future poses warm. */
export const GHOST_COLORS = Object.freeze({ before: "#4d9cff", after: "#ff8a3d" });
const NEAR_OPACITY = 0.46, FAR_OPACITY = 0.14;

const clampInt = (value, { min, max }, fallback) => (Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback);

/** A full, valid setting from a partial one (unknown modes keep the current mode). */
export function normalizeGhostSettings(patch = {}, base = GHOST_DEFAULTS) {
	return Object.freeze({
		mode: GHOST_MODES.includes(patch.mode) ? patch.mode : base.mode,
		count: clampInt(patch.count, GHOST_COUNT, base.count),
		step: clampInt(patch.step, GHOST_STEP, base.step),
	});
}

let current = GHOST_DEFAULTS;
const listeners = new Set();
export const ghostSettings = () => current;
export function setGhostSettings(patch) {
	const next = normalizeGhostSettings(patch, current);
	if (next.mode === current.mode && next.count === current.count && next.step === current.step) return current;
	current = next;
	for (const listener of listeners) listener();
	return current;
}
/** What a views contact sheet draws (verify_result ghosts): the viewport's setting while it is on, else 3 each side every 4 frames. */
export const sheetGhostSettings = () => (current.mode === "off" ? { ...GHOST_DEFAULTS, mode: "step" } : current);
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const useGhostSettings = () => useSyncExternalStore(subscribe, ghostSettings, ghostSettings);

/** One sentence for receipts and tooltips. */
export function describeGhosts({ mode, count, step }) {
	if (mode === "off") return "Ghosts off.";
	return `Ghosts: ${count} before and ${count} after the playhead, ${mode === "keys" ? "at the spec's key frames" : `every ${step} frame${step === 1 ? "" : "s"}`}.`;
}

/**
 * The frames that get a ghost around `frame` within 0..last: `count` on each side, every `step`
 * frames, or the nearest of `keyFrames` (mode keys). rank 1 is the nearest; the playhead's own
 * frame never gets one.
 */
export function ghostFrames({ frame, last, mode, count, step, keyFrames = [] }) {
	if (mode === "off" || !(last >= 0)) return [];
	const at = Math.max(0, Math.min(last, Math.round(frame) || 0)), out = [];
	const keys = mode === "keys" ? [...new Set(keyFrames.map(Math.round))].filter((f) => f >= 0 && f <= last).sort((x, y) => x - y) : null;
	const before = keys ? keys.filter((f) => f < at).reverse() : null, after = keys ? keys.filter((f) => f > at) : null;
	for (let rank = 1; rank <= count; rank++) {
		const early = keys ? before[rank - 1] : at - rank * step, late = keys ? after[rank - 1] : at + rank * step;
		if (early >= 0) out.push({ f: early, side: "before", rank });
		if (late <= last) out.push({ f: late, side: "after", rank });
	}
	return out;
}

/** Colour and opacity of a ghost: its side's hue, fading with its distance in time. */
export function ghostLook(side, rank, count) {
	const t = count > 1 ? (rank - 1) / (count - 1) : 0;
	return { color: GHOST_COLORS[side], opacity: +(NEAR_OPACITY + (FAR_OPACITY - NEAR_OPACITY) * t).toFixed(3) };
}

const keyCache = new WeakMap();
/**
 * The key frames of an installed take v3: its spec's keys with the skills it uses expanded
 * (expandUse, lenient), the held-object keys and each generator's start, ascending. A retimed
 * take (fix.retime) is not remapped: these are the spec's frames. [] for anything else.
 */
export function takeKeyFrames(take, objects = []) {
	if (take?.schema !== "cozyclay.take.v3" || !take.spec) return [];
	if (keyCache.has(take)) return keyCache.get(take);
	let spec = take.spec;
	try {
		const sk = skeletonFor(take.rig);
		if (sk && spec.use?.length) spec = expandUse(spec, { sk, scene: motionScene(objects), lenient: true }).spec;
	} catch { spec = take.spec; }
	const frames = [
		...(spec.keys ?? []).map((k) => k?.f),
		...Object.values(spec.objects ?? {}).flatMap((o) => (Array.isArray(o?.keys) ? o.keys.map((k) => k?.f) : [])),
		...(spec.generators ?? []).map((g) => g?.f0),
	].filter(Number.isFinite);
	const keys = [...new Set(frames.map(Math.round))].sort((a, b) => a - b);
	keyCache.set(take, keys);
	return keys;
}
