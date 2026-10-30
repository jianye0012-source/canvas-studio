// Kits (docs/motion-api-v3.1.md C15): ready-made, correctly scaled props built as a group, an
// Empty root plus parts. The root is the grip: carried with the entry `bind` names (at/along pin
// it to the prop origin), it puts every part where the hand holds it. Parts are ordinary records
// (sculpts, primitives, effects, lights) parented to the root; a part that glows, burns or lights
// up carries the switch entry a take uses to show it (`switch`). The exhale kit rides no hand: its
// root's entry is a follow (C16).
//   buildKit(kit, existing, { name?, position? }) -> { records, rootId, parts: { role: id }, bind, props?, use? } | { error }
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { createSceneObject, createSculptObject, normalizeSceneObject, EMPTY_KIND } from "../scene-objects.js";
import { cigarette, lighter, exhale } from "./smoking.js";
import { bat, ball, sword, pistol } from "./held.js";

const KITS = { cigarette, lighter, exhale, bat, ball, sword, pistol };
export const KIT_NAMES = Object.keys(KITS);
const DEG = Math.PI / 180;

/** inspect_studio { scope: "catalogue" } kits: name, roles, the prop the root rides (or the point it follows) and one line. */
export const KIT_CATALOGUE = KIT_NAMES.map(kit => ({ kit, parts: KITS[kit].parts.map(p => p.role), ...(KITS[kit].prop ? { prop: KITS[kit].prop } : { follow: KITS[kit].carry.follow }),
	description: KITS[kit].description }));

const uniqueName = (base, existing) => {
	const names = new Set(existing.map(o => o.name));
	let name = base;
	for (let n = 2; names.has(name); n += 1) name = `${base} ${n}`;
	return name;
};

/** A fresh record of the part's kind (null when this build has no such kind). */
function freshPart(part, existing, name) {
	if (part.kind === "sculpt") return createSculptObject({ recipe: part.recipe, name }, existing).object ?? null;
	return createSceneObject(part.kind, existing);
}

const scratch = { pos: new Vector3(), quat: new Quaternion(), scale: new Vector3(), euler: new Euler() };

/** The world pose of a root-frame part as record fields: position, XYZ Euler degrees, scale. */
function placed(rootMatrix, part) {
	const local = new Matrix4().compose(new Vector3(...part.at), new Quaternion().setFromEuler(new Euler(...(part.rot ?? [0, 0, 0]).map(v => v * DEG), "XYZ")), new Vector3(1, 1, 1));
	new Matrix4().multiplyMatrices(rootMatrix, local).decompose(scratch.pos, scratch.quat, scratch.scale);
	scratch.euler.setFromQuaternion(scratch.quat, "XYZ");
	const round = v => Math.round(v * 1e5) / 1e5, [sx, sy, sz] = part.scale ?? [1, 1, 1];
	return { x: round(scratch.pos.x), y: round(scratch.pos.y), z: round(scratch.pos.z), rotX: round(scratch.euler.x / DEG), rot: round(scratch.euler.y / DEG), rotZ: round(scratch.euler.z / DEG),
		scaleX: sx, scaleY: sy, scaleZ: sz };
}

/**
 * The records of kit `kit` (the root first), placed at `position` ({ x, y, z, rot }: the root,
 * world m and yaw degrees; y is lifted so no part's base is under the floor), with ids and names
 * unique against `existing`.
 */
export function buildKit(kit, existing = [], { name, position = {} } = {}) {
	const def = KITS[kit];
	if (!def) return { error: `kit "${kit}" is not a kit (kits: ${KIT_NAMES.join(", ")})` };
	const yaw = Number(position.rot) || 0, lift = Math.max(0, ...def.parts.map(p => -p.at[1]));
	const rootName = uniqueName(typeof name === "string" && name.trim() ? name.trim() : def.label, existing);
	const root = normalizeSceneObject({ ...createSceneObject(EMPTY_KIND, existing, { x: position.x, z: position.z, rot: yaw }), name: rootName, y: Math.max(lift, Number(position.y) || 0) });
	const rootMatrix = new Matrix4().compose(new Vector3(root.x, root.y, root.z), new Quaternion().setFromEuler(new Euler(0, yaw * DEG, 0, "XYZ")), new Vector3(1, 1, 1));
	const records = [root], parts = {}, bind = { [root.id]: def.carry }, skipped = [];
	for (const part of def.parts) {
		const all = [...existing, ...records], partName = uniqueName(`${rootName} ${part.role}`, all), fresh = freshPart(part, all, partName);
		const record = fresh && normalizeSceneObject({ ...fresh, ...placed(rootMatrix, part), name: partName, parent: root.id,
			...(part.color ? { color: part.color } : {}), ...(part.glow ? { glow: part.glow } : {}), ...(part.effect ? { effect: part.effect } : {}), ...(part.light ? { light: part.light } : {}),
			...(part.showOnlyInTake ? { showOnlyInTake: true } : {}) });
		if (!record) { skipped.push(part.role); continue; }
		records.push(record);
		parts[part.role] = record.id;
		if (part.switch) bind[record.id] = part.switch;
	}
	return { records, rootId: root.id, parts, bind, ...(def.props ? { props: def.props } : {}), ...(def.skill ? { skill: def.skill } : {}), ...(skipped.length ? { skipped } : {}) };
}
