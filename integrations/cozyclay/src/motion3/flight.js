// A fall that leaves with a velocity (#816): a thrown thing. fall.v is the velocity its root leaves with, m/s, or "hand"
// on a carry: the velocity the hand gives it at the release, its pose a frame after minus a frame before, x fps (the
// frames beforePose gives the spin from, free-motion.js afterRelease). Without v, and with v zero, a fall is as before.
// It flies on a parabola (G of free-motion.js) and lands on the first surface its path comes down onto: the highest top
// whose point under the path at that height lies on that body (closed form per top, no stepping).
import { add, scale, sub } from "./compiler/math.js";

const ZERO = [0, 0, 0];

/** The velocity fall leaves with from root pose `start` (`before`: its pose a frame earlier, a hand's release), m/s. */
export function fallVelocity(fall, start, before, fps) {
	if (Array.isArray(fall?.v)) return fall.v;
	if (fall?.v === "hand" && before) return scale(sub(start.pos, before.pos), fps);
	return ZERO;
}

export const moves = v0 => v0.some(v => v !== 0);

/** Seconds until a point h m above its landing, leaving upward at vy m/s, comes down to it (G m/s^2). */
export const flightTime = (h, vy, G) => (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, h))) / G;

/** The x/z drift of a flight t s in (at most tl s, where it lands). */
export const drift = (v0, t, tl) => { const u = Math.min(t, tl); return [v0[0] * u, 0, v0[2] * u]; };

/**
 * landingOf (free-motion.js) for a fall from `start` leaving at v0: { support, top, h } under where it comes down. `land`
 * is landingOf(spec, scene, id, pose, onto), `tops` the heights of the bodies it may come down on, G gravity. Coming down,
 * it meets the highest surface whose point under its path at that height is on that surface: each top from the highest
 * down, the drift to that height, and the support there kept when it is that top (else the next lower; the floor last).
 */
export function landingWith(land, start, v0, G, tops = []) {
	const here = land(start), low = here.top + here.h, at = top => ({ pos: add(start.pos, drift(v0, flightTime(low - top, v0[1], G), Infinity)), R: start.R });
	for (const top of [...new Set(tops)].filter(t => t <= low).sort((a, b) => b - a)) {
		const there = land(at(top));
		if (Math.abs(there.top - top) < 1e-9) return there;
	}
	return land(at(0));
}
