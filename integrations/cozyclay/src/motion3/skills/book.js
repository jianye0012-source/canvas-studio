// Skill plumbing: a key book that tracks the channel state while a skill writes keys, and the
// placement of choreography written in a template frame (e.g. a car's own frame, driver side
// on +X) into the scene: translate, turn by a yaw, and mirror left/right for the other side.
import { add, apply, ry } from "../compiler/math.js";

const SIDE_SWAP = { _l: "_r", _r: "_l" };
const NEGATE_ON_MIRROR = /^(yaw|roll|spine_yaw|spine_roll|head_yaw|head_roll|fyaw_[lr]|wtwist_[lr]|wflex_[lr])$/;
const POINT = /^(root|foot_[lr]|hand_[lr])$/, POLE = /^(knee|elbow)_[lr]$/, YAW = /^(yaw|fyaw_[lr])$/;

const clone = v => (v && typeof v === "object" ? structuredClone(v) : v);
export const swapSide = name => name.replace(/_(l|r)$/, m => SIDE_SWAP[m]).replace(/^(Left|Right)/, m => (m === "Left" ? "Right" : "Left"));

/**
 * A frame: { origin: [x,y,z], yaw (deg), mirror (bool), negate: Set of extra channels (hinge
 * angles) to negate, names: { anchor: mirroredAnchor } }. Template points p map to
 * origin + ry(yaw)(mirror ? [-x, y, z] : p).
 */
export const identityFrame = () => ({ origin: [0, 0, 0], yaw: 0, mirror: false, negate: new Set(), names: {} });

const placePoint = (fr, p) => add(fr.origin, apply(ry(fr.yaw), fr.mirror ? [-p[0], p[1], p[2]] : p));
export const placeDir = (fr, v) => (fr.mirror ? [-v[0], v[1], v[2]] : v.slice());

/** A channel name in the placed frame (sides swap and anchor names rename when mirrored). */
export function placeChannel(fr, ch) {
	if (!fr.mirror) return ch;
	const w = /^w_(.+)_([lr])$/.exec(ch);
	if (w) return `w_${fr.names[w[1]] ?? w[1]}_${w[2] === "l" ? "r" : "l"}`;
	return /_[lr]$/.test(ch) ? swapSide(ch) : ch;
}

function placeSet(fr, set) {
	const out = {};
	for (const [ch, v0] of Object.entries(set)) {
		let v = clone(v0);
		if (POINT.test(ch)) v = placePoint(fr, v);
		else if (POLE.test(ch)) v = placeDir(fr, v);
		else if (typeof v === "number") {
			if (fr.mirror && (NEGATE_ON_MIRROR.test(ch) || fr.negate.has(ch))) v = -v;
			if (YAW.test(ch)) v += fr.yaw;
		}
		out[placeChannel(fr, ch)] = v;
	}
	return out;
}

/**
 * Keys relative to f0 (book.at(12, ...) writes frame f0 + 12). `at` and `step` take template
 * values and place them; `hold` re-keys the current (already placed) values.
 */
export function keyBook(state, f0 = 0, fr = identityFrame()) {
	const keys = [], name = ch => placeChannel(fr, ch);
	return {
		state, keys, frame: fr,
		at(f, set) { const placed = placeSet(fr, set); Object.assign(state, clone(placed)); keys.push({ f: f0 + f, set: placed }); },
		hold(f, ...names) { keys.push({ f: f0 + f, set: Object.fromEntries(names.filter(n => state[name(n)] !== undefined).map(n => [name(n), clone(state[name(n)])])) }); },
		step(f, ch, value) {
			const n = name(ch);
			keys.push({ f: f0 + f - 1, set: { [n]: state[n] } });
			state[n] = value;
			keys.push({ f: f0 + f, set: { [n]: value }, step: [n] });
		},
	};
}

/** Throws the skill's own MOTION_SPEC_INVALID message. */
export const skillError = (tag, msg) => { throw new Error(`MOTION_SPEC_INVALID: ${tag}: ${msg}`); };

/** Scene box by id or a skill error naming the arg. */
export function sceneBox(ctx, arg, id) {
	const box = ctx.scene?.objects?.[id];
	if (!box) skillError(ctx.tag, `args.${arg} "${id}" is not a scene object`);
	return box;
}

/** Yaw (deg) of a box's rotation matrix about +Y. */
export const yawOf = R => Math.atan2(R[0][2], R[2][2]) * 180 / Math.PI;
