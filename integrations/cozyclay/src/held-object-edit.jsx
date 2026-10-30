import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GIZMO_LAYER } from "./dualview.jsx";
import { drawnPose, editKindAt, hingedRootPose, keyObjectArgs, movedRootPose, rootTrackPose, tipTrail, trackedMoverOf, withPreview } from "./held-object-pose.js";

/**
 * Editing an object a compiled take draws, from the viewport gizmo.
 *
 * - The gizmo stands on the drawn pose (held-object-pose.js drawnPose): the
 *   world centre and rotation the take gives the selection at this frame.
 * - While a hand holds the object, a move or rotate drag moves the track's
 *   root (the body, or its carried group root). The object follows the
 *   pointer through a one-frame preview of the track. On release the pose is
 *   sent as `motion.keyObject`, which keys it, recompiles the take and makes
 *   the hand follow (docs/motion-api-v3.1.md C14).
 * - A hinged object: a ring drag turns it about its hinge and keys that
 *   angle through the same action (the engine keeps the turn about the axis).
 * - Anything else (not in hand at this frame, a move on a hinge, or no take)
 *   keeps the plain placement drag on the authored record.
 *
 * Returns the tracks to draw with (the preview applied) and the controller the
 * ObjectGizmo `held` prop takes, with the tip trail of a carried object.
 */
export function useHeldObjectEdit({ selected, objects, tracks, frame, frameCount, fps, motion, run }) {
	const [preview, setPreview] = useState(null);
	const dragRef = useRef(null);
	const lookup = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
	const shown = withPreview(tracks, preview);
	const id = selected?.id ?? null;
	const mover = id ? trackedMoverOf(lookup, shown, id) : null;
	const pose = mover ? drawnPose(lookup, id, frame, { frameCount, fps, objectTracks: shown }) : null;
	const track = mover ? tracks.get(mover.id) : null;
	const characterId = track?.characterId ?? null;
	const kind = mover ? editKindAt(mover.track, frame) : null;
	// The take's own spec entry: a carry's keys, a hinge's pivot and axis.
	const entry = characterId ? motion?.motionFor?.(characterId)?.spec?.objects?.[mover.id] ?? null : null;
	const keys = entry?.keys;
	const keyList = Array.isArray(keys) ? keys.map((key) => key?.f).filter(Number.isFinite).join(",") : "";
	// The trail walks every frame, so it is rebuilt only when what it reads
	// changes. Held frames are drawn by the mover's own track alone (the hold
	// cuts the carry from above), so that track is the whole take it needs.
	const moverId = mover?.id ?? null, pos = track?.pos, quat = track?.quat, hold = track?.hold, count = track?.frameCount;
	const trail = useMemo(() => {
		if (!moverId || !hold) return null;
		const only = { frameCount: count, pos, quat, hold };
		const keyFrames = keyList ? keyList.split(",").map(Number) : [];
		return tipTrail(lookup, id, { track: only }, { frameCount, fps, objectTracks: new Map([[moverId, only]]) }, keyFrames);
	}, [lookup, id, moverId, pos, quat, hold, count, frameCount, fps, keyList]);
	useEffect(() => {
		// QA hook: what the gizmo stands on, read by the browser checks.
		window.__heldGizmo = pose ? { id, mover: moverId, kind, characterId, pose } : null;
	});
	const show = (build) => {
		const drag = dragRef.current;
		if (!drag) return;
		drag.last = build(drag);
		setPreview({ id: drag.id, frame: drag.frame, ...drag.last });
	};
	const gizmo = pose && {
		pose,
		trail,
		// In hand: move and rotate key the pose. A hinge: the rings key its
		// angle (the turn about the hinge axis); a move stays the plain drag.
		editable: (kind === "held" || kind === "hinge") && Boolean(characterId),
		hinge: kind === "hinge",
		begin() {
			dragRef.current = { id: moverId, frame: Math.round(frame), root: rootTrackPose(track, frame), pivot: pose.centre, characterId, hinge: kind === "hinge" ? entry ?? {} : null, last: null };
			return true;
		},
		move: (travel) => show((drag) => movedRootPose(drag.root, drag.pivot, { travel })),
		rotate: (axis, degrees) => show((drag) => (drag.hinge ? hingedRootPose(drag.root, drag.pivot, drag.hinge, axis, degrees) : movedRootPose(drag.root, drag.pivot, { axis, degrees }))),
		end(commit) {
			const drag = dragRef.current;
			dragRef.current = null;
			if (!commit || !drag?.last) return setPreview(null);
			let answer = null;
			try {
				answer = run("motion.keyObject", keyObjectArgs(drag.characterId, drag.id, drag.frame, drag.last, { hinge: Boolean(drag.hinge) }));
			} catch (error) {
				console.warn("motion.keyObject failed", error);
			}
			// The preview stays until the recompiled take is installed, so the object does not jump back first.
			Promise.resolve(answer).finally(() => setPreview(null));
		},
	};
	return { tracks: shown, gizmo };
}

const TRAIL_COLOR = "#ffd23d";

/** The held object's tip arc and its key markers: editor furniture on GIZMO_LAYER, never recorded. */
export function HeldTrail({ trail }) {
	const geometry = useMemo(() => (trail ? new THREE.BufferGeometry().setFromPoints(trail.points.map((point) => new THREE.Vector3(...point))) : null), [trail]);
	useEffect(() => () => geometry?.dispose(), [geometry]);
	const groupRef = useRef(null);
	useEffect(() => {
		groupRef.current?.traverse((node) => node.layers.set(GIZMO_LAYER));
	});
	if (!trail) return null;
	return (
		<group ref={groupRef}>
			<line geometry={geometry} renderOrder={997} frustumCulled={false}>
				<lineBasicMaterial color={TRAIL_COLOR} transparent opacity={0.8} depthTest={false} depthWrite={false} />
			</line>
			{trail.keys.map((point, index) => (
				<mesh key={index} position={point} renderOrder={997}>
					<sphereGeometry args={[0.025, 10, 8]} />
					<meshBasicMaterial color={TRAIL_COLOR} depthTest={false} depthWrite={false} transparent />
				</mesh>
			))}
		</group>
	);
}
