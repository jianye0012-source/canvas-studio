import { Matrix4, Quaternion, Vector3 } from "three";
import { sceneObjectTravelMatrixAt } from "./object-travel.js";
import { EMPTY_KIND } from "./scene-objects.js";

/**
 * Pose and placement math for editing an object a compiled take draws (a bat
 * in a hand, a hinged door, the parts of a carried group).
 *
 * The take's track sets the pose such an object is drawn at, every frame. Its
 * authored record is not that pose, so a gizmo on the record stands in the
 * wrong place and a drag on the record changes nothing on screen. The gizmo
 * stands on the drawn pose instead, and a drag moves the root of the track
 * (the body, or the group root that carries it). The new root pose becomes a
 * held-object key (motion.keyObject, docs/motion-api-v3.1.md C14).
 *
 * Track poses are the record's base pivot (bottom centre) in world space, as
 * object-travel.js composes them.
 */

const frameIndex = (track, frame) => Math.max(0, Math.min(track.frameCount - 1, Math.round(frame) || 0));
const parentOf = (lookup, record) => (typeof record.parent === "string" ? lookup.get(record.parent) : null);

/**
 * The take track that draws record `id`: its own, else the nearest tracked
 * ancestor's (a carried group root moves its parts). Null when no take draws it
 * or the chain reaches a record that rides a character bone (`attach`).
 * @returns {{ id: string, track: object } | null}
 */
export function trackedMoverOf(lookup, tracks, id) {
	const seen = new Set();
	for (let record = lookup.get(id); record && !seen.has(record.id); record = parentOf(lookup, record)) {
		seen.add(record.id);
		if (record.attach) return null;
		const track = tracks?.get?.(record.id);
		if (track) return { id: record.id, track };
	}
	return null;
}

/**
 * What a drag on the mover writes at `frame`: "held" while a hand holds it (a
 * carried track with its hold flag up), "hinge" for a track with no hold flags,
 * null when it is carried but not in hand (before the grab, after the release).
 */
export function editKindAt(track, frame) {
	if (!track?.hold) return track ? "hinge" : null;
	return track.hold[frameIndex(track, frame)] === 1 ? "held" : null;
}

/** The record's own centre in its local frame: half its height up from the base, or the origin of an Empty. */
function localCentre(record, out) {
	return out.set(0, record.renderer === EMPTY_KIND ? 0 : (record.height ?? 1) / 2, 0);
}

/**
 * Where record `id` is drawn at `frame`: its world centre and world rotation,
 * as plain arrays. Null when nothing moves it (the authored record is the pose).
 * @returns {{ centre: number[], quat: number[] } | null}
 */
export function drawnPose(lookup, id, frame, take) {
	const record = lookup.get(id);
	const matrix = record ? sceneObjectTravelMatrixAt(lookup, id, frame, take, new Matrix4()) : null;
	if (!matrix) return null;
	const quat = new Quaternion();
	matrix.decompose(new Vector3(), quat, new Vector3());
	return { centre: localCentre(record, new Vector3()).applyMatrix4(matrix).toArray(), quat: quat.toArray() };
}

/** The mover's root pose at `frame` from its track: { pos, quat } as three.js values. */
export function rootTrackPose(track, frame) {
	const f = frameIndex(track, frame);
	return {
		pos: new Vector3().fromArray(track.pos, f * 3),
		quat: new Quaternion().fromArray(track.quat, f * 4),
	};
}

/**
 * The root pose after a rigid drag about `pivot` (the gizmo's centre): first a
 * turn of `degrees` about the world `axis` through the pivot, then a world
 * `travel`. Either part may be absent.
 */
export function movedRootPose(root, pivot, { travel = null, axis = null, degrees = 0 } = {}) {
	const pos = root.pos.clone();
	const quat = root.quat.clone();
	if (axis && degrees) {
		const turn = new Quaternion().setFromAxisAngle(axis.clone().normalize(), (degrees * Math.PI) / 180);
		const centre = new Vector3().fromArray(pivot);
		pos.sub(centre).applyQuaternion(turn).add(centre);
		quat.premultiply(turn).normalize();
	}
	if (travel) pos.add(travel);
	return { pos, quat };
}

/**
 * A ring drag on a hinged object: only the turn about the hinge axis is kept
 * (the engine keeps the same, C14), about the hinge pivot. `hinge` is its
 * spec.objects entry ({ pivot, axis }, world space); without a pivot the
 * gizmo centre stands in.
 */
export function hingedRootPose(root, centre, hinge, axis, degrees) {
	const hingeAxis = new Vector3().fromArray(hinge?.axis ?? [0, 1, 0]).normalize();
	return movedRootPose(root, hinge?.pivot ?? centre, { axis: hingeAxis, degrees: degrees * axis.clone().normalize().dot(hingeAxis) });
}

const snapTo = (value, step) => (step ? Math.round(value / step) * step : value);

/**
 * A move drag's world travel: the pointer's world delta read along each free
 * axis (one for an arrow, two for a plane square), each snapped to `step` m.
 */
export function dragTravel(delta, axes, step = 0) {
	const travel = new Vector3();
	for (const axis of axes) travel.addScaledVector(axis, snapTo(delta.dot(axis), step));
	return travel;
}

/** A ring drag's turn in degrees, snapped to `step`. */
export const dragTurn = (degrees, step = 0) => snapTo(degrees, step);

/**
 * The tracks with one frame of one mover replaced by a preview pose, so the
 * object follows the pointer while a drag is open. The source tracks are not
 * changed.
 */
export function withPreview(tracks, preview) {
	const track = preview && tracks?.get?.(preview.id);
	if (!track) return tracks;
	const f = frameIndex(track, preview.frame);
	const pos = Float32Array.from(track.pos);
	const quat = Float32Array.from(track.quat);
	pos.set(preview.pos.toArray(), f * 3);
	quat.set(preview.quat.toArray(), f * 4);
	return new Map(tracks).set(preview.id, { ...track, pos, quat });
}

const round = (value) => Math.round(value * 1e4) / 1e4;

/**
 * The motion.keyObject arguments for a root pose at `frame` (world metres, quaternion [x, y, z, w]).
 * A hinge sends the rotation alone: the engine keeps its turn about the hinge axis.
 */
export function keyObjectArgs(characterId, objectId, frame, pose, { hinge = false } = {}) {
	return {
		characterId,
		objectId,
		frame: Math.max(0, Math.round(frame)),
		...(hinge ? {} : { pos: pose.pos.toArray().map(round) }),
		rot: pose.quat.clone().normalize().toArray().map(round),
	};
}

/**
 * The arc the held object draws: the tip of record `id` (its top along its own
 * +Y, or the origin of an Empty) at every frame its mover is in hand, and the
 * tip at each key frame. Null when the mover has no hold flags.
 * @returns {{ points: number[][], keys: number[][] } | null}
 */
export function tipTrail(lookup, id, mover, take, keyFrames = []) {
	const record = lookup.get(id);
	const hold = mover?.track?.hold;
	if (!record || !hold) return null;
	const tipLocal = new Vector3(0, record.renderer === EMPTY_KIND ? 0 : (record.height ?? 1), 0);
	const matrix = new Matrix4();
	const tipAt = (frame) => (sceneObjectTravelMatrixAt(lookup, id, frame, take, matrix) ? tipLocal.clone().applyMatrix4(matrix).toArray() : null);
	const points = [];
	for (let frame = 0; frame < mover.track.frameCount; frame += 1) {
		if (hold[frame] !== 1) continue;
		const tip = tipAt(frame);
		if (tip) points.push(tip);
	}
	const keys = keyFrames.filter((frame) => hold[frameIndex(mover.track, frame)] === 1).map(tipAt).filter(Boolean);
	return points.length > 1 ? { points, keys } : null;
}
