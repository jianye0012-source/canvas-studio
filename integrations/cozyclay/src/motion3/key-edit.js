// motion.keyObject (C14): one key of an object the take moves, upserted into (or removed from) a
// copy of the take's spec. The caller compiles and installs the copy.
//   carry  objects.<id>.keys[{ f, pos, rot }] or [{ f, pos, aim, roll? }] (C16): the world pose of its
//          base (a group: its root), only while it is in hand (grab..release); kept sorted by f; the
//          last one removed drops `keys`
//   hinge  spec.keys[{ f, set: { <channel>: degrees } }]: `angle`, or the turn of `rot` (the drawn
//          world rotation) about the hinge axis from the scene pose; a key at f is reused
// An object a skill moves (exitCar's door hinge) is keyed the same way: a hinge through its channel,
// a carry by copying the skill's entry into spec.objects with the keys (the spec's own entry wins).
// Frames are the spec's (absolute). Errors carry the MOTION_SPEC_INVALID: prefix (INVALID_ARGUMENT).
import { isCarried, isFollow, movesRecord } from "./carried.js";
import { groupsOf } from "./scene.js";
import { mul, T, norm, quatFromMat, matFromQuat } from "./compiler/math.js";

const bad = msg => { throw new Error(`MOTION_SPEC_INVALID: ${msg}`); };
const round = (v, d) => Math.round(v * d) / d;
const framesOf = list => (list.length ? list.map(f => `f${f}`).join(", ") : "none");

/** The spec.objects key that moves scene body `id` (itself or its nearest group; a switch moves nothing), or null. */
function moverOf(spec, scene, id) {
	return [id, ...(scene?.objects?.[id]?.ancestors ?? [])].find(k => movesRecord(spec.objects?.[k])) ?? null;
}

/** Degrees the world rotation `rot` turns about `axis` from the rest rotation (the twist, -180..180). */
function hingeAngle(rot, rest, axis) {
	const q = quatFromMat(mul(matFromQuat(rot), T(rest.R))), a = norm(axis), sg = q[3] < 0 ? -1 : 1;
	const deg = 2 * Math.atan2(sg * (q[0] * a[0] + q[1] * a[1] + q[2] * a[2]), sg * q[3]) * 180 / Math.PI;
	return round(deg > 180 ? deg - 360 : deg, 100);
}

function carryKey(spec, id, o, { frame, pos, rot, aim, roll, remove }) {
	const lo = o.grab ?? 0, hi = o.release ?? spec.frames - 1, keys = [...(o.keys ?? [])].filter(k => k.f !== frame);
	if (frame < lo || frame > hi) bad(`"${id}" is in hand only f${lo}..f${hi} (grab..release); at f${frame} the take does not hold it, so drag it as a scene object, or change objects.${id}.grab/release first`);
	if (remove) {
		if (keys.length === (o.keys ?? []).length) bad(`"${id}" has no key at f${frame}; its keys: ${framesOf((o.keys ?? []).map(k => k.f))}`);
	} else {
		if (!Array.isArray(pos) || Array.isArray(rot) === Array.isArray(aim)) {
			bad(`keying "${id}" (carried) needs pos [x, y, z] and rot [x, y, z, w] or aim [x, y, z] (+ roll), one of the two: the world pose of its base (a group: its root)`);
		}
		const turn = rot ? { rot: rot.map(v => round(v, 1e5)) } : { aim: aim.map(v => round(v, 1e5)), ...(Number.isFinite(roll) && roll ? { roll: round(roll, 100) } : {}) };
		keys.push({ f: frame, pos: pos.map(v => round(v, 1e4)), ...turn });
	}
	const { keys: _old, ...rest } = o;
	spec.objects[id] = keys.length ? { ...rest, keys: keys.sort((a, b) => a.f - b.f) } : rest;
	return { kind: "carry", f: frame, ...(remove ? { removed: true } : {}), keys: keys.map(k => k.f) };
}

function hingeKey(spec, scene, id, o, { frame, rot, angle, remove }) {
	const ch = o.channel, i = (spec.keys ?? []).findIndex(k => k?.f === frame && !k.src && k.set && ch in k.set);
	if (remove) {
		if (i < 0) bad(`"${id}" (hinge, channel "${ch}") has no key at f${frame}; ${ch} is keyed at ${framesOf((spec.keys ?? []).filter(k => k?.set && ch in k.set).map(k => k.f))}`);
		const { [ch]: _gone, ...set } = spec.keys[i].set;
		spec.keys = Object.keys(set).length ? spec.keys.map((k, j) => (j === i ? { ...k, set, ...(k.step ? { step: k.step.filter(c => c !== ch) } : {}) } : k)) : spec.keys.filter((_, j) => j !== i);
		return { kind: "hinge", channel: ch, f: frame, removed: true };
	}
	const rest = scene?.objects?.[id] ?? groupsOf(scene)[id];
	const value = Number.isFinite(angle) ? round(angle, 100) : Array.isArray(rot) && rest ? hingeAngle(rot, rest, o.axis ?? [0, 1, 0])
		: bad(`keying "${id}" (a hinge on channel "${ch}") needs angle (degrees) or rot [x, y, z, w] (its drawn world rotation; the turn about the hinge axis is kept)`);
	const at = (spec.keys ?? []).findIndex(k => k?.f === frame && !k.src);
	spec.keys = at < 0 ? [...(spec.keys ?? []), { f: frame, set: { [ch]: value } }] : spec.keys.map((k, j) => (j === at ? { ...k, set: { ...k.set, [ch]: value } } : k));
	return { kind: "hinge", channel: ch, f: frame, angle: value };
}

/**
 * keyObject(spec, scene, { objectId, frame, pos?, rot?, aim?, roll?, angle?, remove? }, skillObjects?) -> { spec, keyed }:
 * a copy of the spec with the key written, and what was written ({ objectId, kind, f, ... }).
 * skillObjects are the spec.objects entries its skills add (skills/index.js expandUse).
 */
export function keyObject(stored, scene, args, skillObjects = {}) {
	const spec = structuredClone(stored), { objectId: id, frame } = args, moves = x => (movesRecord(x) ? x : undefined);
	const o = moves(spec.objects?.[id]) ?? structuredClone(moves(skillObjects[id]));
	if (!o) {
		const mover = moverOf({ objects: { ...skillObjects, ...spec.objects } }, scene, id);
		bad(mover ? `"${id}" moves with "${mover}" (spec.objects.${mover}); key "${mover}" with its root pose`
			: `"${id}" is not in this take's spec.objects (${Object.keys({ ...skillObjects, ...spec.objects }).join(", ") || "none"}): the take neither carries nor hinges it, so drag it as a scene object`);
	}
	if (!(Number.isInteger(frame) && frame >= 0 && frame < spec.frames)) bad(`frame ${frame} is outside the take (0..${spec.frames - 1})`);
	if (isFollow(o)) bad(`"${id}" follows ${o.follow} (spec.objects.${id}); it has no keys: change its follow, offset or aim`);
	if (isCarried(o)) spec.objects = { ...spec.objects, [id]: o };
	const keyed = isCarried(o) ? carryKey(spec, id, o, args) : hingeKey(spec, scene, id, o, args);
	return { spec, keyed: { objectId: id, ...keyed } };
}
