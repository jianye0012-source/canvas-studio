// Scene records -> what the motion compiler and QA collide with: each drawable object as an
// oriented box on its base pivot (bottom centre), sized by objectSize (scene-objects.js, the
// one owner of footprint x scale) and turned by the renderer's Euler XYZ (rotX, rot, rotZ).
// Every entry lists its `ancestors` (parent ids, nearest group first) and their poses
// (`ancestorPoses`, the same order), so a group (an Empty, which has no box of its own) is known
// by its parts (object-pose.js partsOf) and by its root pose. A saved take keeps scene.objects
// and scene.others (take-source.js), so the groups are rebuilt from the entries: groupsOf.
// `others` lists the records with no box (an Empty, a light, an effect, a plane) by id with their
// renderer and ancestors: a switch entry (C15) may name them, and a skill finds a kit's lit parts
// there. A body that glows (record.glow) says so (`glow: true`); a record's grasp sockets (record.grasp,
// ../object-grasp.js) ride along for the hand (sockets.js).
import { objectSize } from "../object-size.js";
import { mul, rx, ry, rz } from "./compiler/math.js";

const NO_BODY = new Set(["empty", "plane", "cutout"]);

/** Parent records of a record, nearest first (stops at a cycle, a missing parent or an attached record). */
function ancestorsOf(o, byId) {
	const out = [];
	for (let p = byId.get(o.parent); p && !out.includes(p) && !p.attach; p = byId.get(p.parent)) out.push(p);
	return out;
}

const poseOf = o => ({ pos: [o.x ?? 0, o.y ?? 0, o.z ?? 0], R: mul(rx(o.rotX ?? 0), mul(ry(o.rot ?? 0), rz(o.rotZ ?? 0))) });

const groupCache = new WeakMap();

/**
 * The groups of a motion scene, rebuilt from its body entries: { id: { pos, R, ancestors,
 * children } }. A group is body-less; `children` lists its direct children (bodies and groups).
 */
export function groupsOf(scene) {
	const objects = scene?.objects ?? {};
	if (groupCache.has(objects)) return groupCache.get(objects);
	const groups = {};
	for (const [id, o] of Object.entries(objects)) {
		(o.ancestors ?? []).forEach((g, i) => {
			const pose = o.ancestorPoses?.[i];
			groups[g] ??= { pos: pose?.pos ?? [0, 0, 0], R: pose?.R ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ancestors: o.ancestors.slice(i + 1), children: [] };
			const child = i ? o.ancestors[i - 1] : id;
			if (!groups[g].children.includes(child)) groups[g].children.push(child);
		});
	}
	groupCache.set(objects, groups);
	return groups;
}

export function motionScene(objects = []) {
	const out = {}, others = {}, byId = new Map(objects.filter(Boolean).map(o => [o.id, o]));
	for (const o of objects) {
		if (!o || o.hidden) continue;
		const size = objectSize(o), up = ancestorsOf(o, byId);
		if (NO_BODY.has(o.renderer) || !(size.width > 0 && size.height > 0 && size.depth > 0)) {
			others[o.id] = { renderer: o.renderer, ancestors: up.map(p => p.id), ...(o.grasp ? { grasp: o.grasp } : {}) };
			continue;
		}
		out[o.id] = { name: o.name, renderer: o.renderer, ...poseOf(o), half: [size.width / 2, size.height / 2, size.depth / 2],
			ancestors: up.map(p => p.id), ...(up.length ? { ancestorPoses: up.map(poseOf) } : {}), ...(o.glow ? { glow: true } : {}), ...(o.grasp ? { grasp: o.grasp } : {}) };
	}
	return { objects: out, groups: groupsOf({ objects: out }), others };
}
