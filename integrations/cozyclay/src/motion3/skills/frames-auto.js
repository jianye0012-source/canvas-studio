// frames: "auto". The spec's length becomes the latest of every skill end, generator end and key
// f, plus 1. Open parameters ({ range: [lo, hi] }) count at their upper bound, so every value the
// search tries fits. The answer is a copy with the number, so the stored spec (and a saved take)
// keeps it; the spec store remembers the "auto" intent beside it (spec-store.js markFramesAuto).
import { findParams } from "../search.js";
import { expandUse } from "./index.js";
import { walkEnd } from "./info.js";

const MAX_FRAMES = 20000;

/** The spec with every open parameter at its upper bound. */
function atUpperBound(spec) {
	const s = structuredClone(spec);
	for (const p of findParams(spec)) {
		let o = s;
		for (const k of p.path.slice(0, -1)) o = o[k];
		o[p.path[p.path.length - 1]] = p.hi;
	}
	return s;
}

/** resolveFrames(spec, { sk, scene, lenient }) -> spec (a copy when frames was "auto", else spec itself). */
export function resolveFrames(spec, { sk, scene, lenient = false } = {}) {
	if (spec?.frames !== "auto") return spec;
	const { spec: full, used } = expandUse({ ...atUpperBound(spec), frames: MAX_FRAMES }, { sk, scene, lenient, auto: true });
	const ends = [...(Array.isArray(full.keys) ? full.keys.map(k => k?.f) : []), ...used.map(u => u.end),
		...(Array.isArray(full.generators) ? full.generators.map(g => (g && Number.isFinite(g.f0) ? walkEnd(g) : null)) : [])];
	return { ...spec, frames: Math.max(0, ...ends.filter(Number.isFinite)) + 1 };
}
