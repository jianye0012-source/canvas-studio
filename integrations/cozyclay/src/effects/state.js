/**
 * What the agent can measure about an effect: `effectStateAt(objectId, frame)`
 * answers { frame, alive, emitter: [x,y,z], bounds: { min, max } | null } in
 * metres, rounded to the millimetre, plus `clamped` when the scene-wide
 * particle cap thinned this emitter.
 *
 * The answer is computed, not read back from the GPU, by the same simulation
 * call the renderer draws with. EffectsLayer publishes the take it draws
 * against; the records come from the caller when it has fresher ones.
 */
import { isEffectivelyHidden } from "../object-hidden.js";
import { evaluateEffects } from "./simulate.js";
import { EFFECT_KIND } from "./effect-record.js";

let readLive = () => null;

/** The renderer's current { take, live } (a reader, so it is always the last render's). */
export function publishEffectScene(read) {
	readLive = typeof read === "function" ? read : () => null;
}

/** The simulation scene for a list of AUTHORED records: effect records, lookup and the authored-hidden set. */
export function effectSceneOf(objects) {
	const records = objects.filter((object) => object?.renderer === EFFECT_KIND);
	return { records, lookup: new Map(objects.map((object) => [object.id, object])),
		hidden: new Set(records.filter((record) => isEffectivelyHidden(record, objects, [])).map((record) => record.id)) };
}

const mm = (value) => {
	const rounded = Math.round(value * 1000) / 1000;
	return rounded === 0 ? 0 : rounded;
};

/** The effect state for one emitter in `scene` (see the module note), or null when it is no effect. */
export function effectStateIn(scene, objectId, frame) {
	const records = scene?.records ?? [];
	if (!records.some((record) => record.id === objectId)) return null;
	const at = Math.max(0, Math.round(Number(frame) || 0));
	const st = evaluateEffects(records, scene, at, { only: objectId }).get(objectId);
	return {
		frame: at, alive: st.alive, emitter: st.emitter.map(mm),
		bounds: st.alive ? { min: st.min.map(mm), max: st.max.map(mm) } : null,
		...(st.clamped ? { clamped: st.clamped } : {}),
	};
}

/** `objects` (authored records) default to the ones the renderer last drew. */
export function effectStateAt(objectId, frame, objects = null) {
	const live = readLive() ?? {};
	const scene = objects ? { ...effectSceneOf(objects), take: live.take ?? {}, live: live.live ?? null } : live;
	return effectStateIn(scene, objectId, frame);
}

/** An inspect_studio entity row with `effect` (the state at `frame`) added for an effect record. */
export function withEffectState(row, frame, objects) {
	if (row?.renderer !== EFFECT_KIND) return row;
	const effect = effectStateAt(row.id, frame, objects);
	return effect ? { ...row, effect } : row;
}
