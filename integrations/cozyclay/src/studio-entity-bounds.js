// The world box an object row reports, in inspect_studio entities, the per-turn context and an
// action readback alike: a body's own box at the playhead (entityWorldBounds, metres, 4 decimals);
// for a node with no body (an empty or a light) the union of every body under it, so a group
// built from parts shows where the whole thing ends; null when nothing there can be measured.
import { entityWorldBounds } from "./studio-agent-commands.js";
import { descendantsOf, isEmptyObject } from "./scene-objects.js";

const AXES = ["x", "y", "z"];

/** World AABB {min,max} of scene object `object` in refreshed Studio state `s`, or null. */
export function objectRowBounds(object, s, ports) {
	const state = { ...s, frame: s.view.frame }, measure = o => entityWorldBounds(o, state, { bounds: ports.bounds });
	if (!isEmptyObject(object)) return measure(object);
	const boxes = descendantsOf(s.objects, object.id).filter(o => !isEmptyObject(o)).map(measure).filter(Boolean);
	if (!boxes.length) return null;
	return { min: Object.fromEntries(AXES.map(a => [a, Math.min(...boxes.map(b => b.min[a]))])),
		max: Object.fromEntries(AXES.map(a => [a, Math.max(...boxes.map(b => b.max[a]))])) };
}
