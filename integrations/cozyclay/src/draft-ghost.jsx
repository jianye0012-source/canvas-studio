// The agent's latest motion draft in the working views (draft-ghost.js decides what shows): one GhostSet slot
// of the drafting character's rig, posed from the draft take on its own loop, the records that take moves
// riding along, and a label over its head ("Draft 3 · QA 31"). Everything sits on GIZMO_LAYER: the shot
// preview card, PlayView, captures, contact sheets and exports never draw it, and it takes no ray. The canvas
// may render on demand, so a shown ghost asks for frames at the take's rate.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { GIZMO_LAYER } from "./dualview.jsx";
import { GhostSet, takeTracks } from "./ghost-set.js";
import { latestDraft, progressVersion, subscribeProgress } from "./agent-progress.js";
import { DRAFT_GHOST_COLOR, DRAFT_GHOST_OPACITY, draftGhostState, draftLabel, useDraftGhostShown } from "./draft-ghost.js";

// Kit parts can mount a frame after the take changes (view-ghosts.jsx does the same).
const SOURCE_PASSES = 3;
// Metres above the head joint; the label's height as a share of the view (sizeAttenuation off).
const LABEL_LIFT = 0.3, LABEL_VIEW_HEIGHT = 0.042, LABEL_PX = { w: 512, h: 96 };
const noRay = () => {};
const headBones = new WeakMap();

/** The ghost rig's head bone, found once per rig. */
function headOf(rig) {
	if (!headBones.has(rig)) {
		let head = null;
		// "mixamorigHead" or "mixamorig:Head": the first depth-first one is the control bone playback.js poses
		rig.traverse(node => { if (!head && node.isBone && /Head$/.test(node.name)) head = node; });
		headBones.set(rig, head);
	}
	return headBones.get(rig);
}

/** A screen-sized label sprite on GIZMO_LAYER, drawn over everything, never picked. */
function makeLabel() {
	const canvas = document.createElement("canvas");
	Object.assign(canvas, { width: LABEL_PX.w, height: LABEL_PX.h });
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false }));
	sprite.center.set(0.5, 0);
	sprite.renderOrder = 1000;
	sprite.layers.set(GIZMO_LAYER);
	sprite.raycast = noRay;
	sprite.userData = { canvas, texture, text: null };
	return sprite;
}

/** Paint `text` as a rounded tag (teal edge; green dot once QA is clean) and size the sprite to it. */
function paintLabel(sprite, text, clean) {
	const { canvas, texture } = sprite.userData;
	if (sprite.userData.text === `${text}|${clean}`) return;
	sprite.userData.text = `${text}|${clean}`;
	const g = canvas.getContext("2d"), font = "600 44px system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
	g.font = font;
	const pad = 26, dot = 34, width = Math.min(LABEL_PX.w - 4, Math.ceil(g.measureText(text).width) + pad * 2 + dot);
	g.clearRect(0, 0, canvas.width, canvas.height);
	g.fillStyle = "rgba(16, 24, 28, 0.82)";
	g.strokeStyle = DRAFT_GHOST_COLOR;
	g.lineWidth = 4;
	g.beginPath();
	g.roundRect((LABEL_PX.w - width) / 2, 8, width, LABEL_PX.h - 16, 30);
	g.fill();
	g.stroke();
	g.fillStyle = clean ? "#46d36f" : DRAFT_GHOST_COLOR;
	g.beginPath();
	g.arc((LABEL_PX.w - width) / 2 + pad + 8, LABEL_PX.h / 2, 9, 0, Math.PI * 2);
	g.fill();
	g.fillStyle = "#eef6f3";
	g.font = font;
	g.textBaseline = "middle";
	g.fillText(text, (LABEL_PX.w - width) / 2 + pad + dot, LABEL_PX.h / 2 + 2);
	texture.needsUpdate = true;
	sprite.scale.set(LABEL_VIEW_HEIGHT * (LABEL_PX.w / LABEL_PX.h), LABEL_VIEW_HEIGHT, 1);
}

/** One viewport frame of the draft ghost: pose the slot at the draft's own clock, tint it, and set the label over its head. */
function frameDraft({ set, label, draft, rig, scene, objects, propTake }) {
	const state = draft ? draftGhostState(draft, Date.now()) : null;
	const on = !!state?.shown && !!rig?.parent;
	label.visible = on;
	if (typeof window !== "undefined") window.__cozyclayDraftGhost = { set, label, draft, state, on };
	if (!set.show(on)) return;
	set.setRig(rig);
	set.syncSources(scene, objects, draft.take, SOURCE_PASSES);
	rig.parent.updateWorldMatrix(true, false);
	set.update({ entries: [{ f: state.frame, side: "after", rank: 1 }], take: draft.take, placement: rig.parent.matrixWorld, propTake, objects, count: 1 });
	const slot = set.slots[0];
	slot.material.color.set(DRAFT_GHOST_COLOR).multiplyScalar(1.15);
	slot.material.opacity = state.opacity;
	const head = headOf(slot.rig);
	if (!head) return;
	set.object.updateMatrixWorld(true);
	head.getWorldPosition(label.position);
	label.position.y += LABEL_LIFT;
	label.material.opacity = Math.min(1, state.opacity / DRAFT_GHOST_OPACITY);
}

/** rigs: live rigs by character id; objects: the authored records (carried ones ride along). */
export function DraftGhost({ rigs, objects }) {
	const version = useSyncExternalStore(subscribeProgress, progressVersion, progressVersion);
	const draft = useMemo(() => latestDraft(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
	const wanted = useDraftGhostShown();
	const scene = useThree(state => state.scene), invalidate = useThree(state => state.invalidate);
	const set = useMemo(() => new GhostSet({ layer: GIZMO_LAYER }), []);
	const label = useMemo(() => makeLabel(), []);
	const rig = draft ? rigs?.[draft.characterId] ?? null : null;
	const active = wanted && !!rig && !!draft?.take;
	const propTake = useMemo(() => (draft?.take ? { frameCount: draft.take.frameCount, fps: draft.take.fps, objectTracks: takeTracks(draft.take) } : null), [draft]);
	useEffect(() => {
		if (!active) return undefined;
		scene.add(set.object);
		set.object.add(label);
		return () => { set.object.remove(label); scene.remove(set.object); };
	}, [active, scene, set, label]);
	useEffect(() => () => {
		set.dispose();
		label.material.dispose();
		label.userData.texture.dispose();
	}, [set, label]);
	useEffect(() => { if (draft) paintLabel(label, draftLabel(draft), draft.qa?.total === 0); }, [draft, label]);
	// A shown ghost moves on its own clock: ask for frames at the take's rate, and one more once it is gone.
	useEffect(() => {
		invalidate();
		if (!active) return undefined;
		const timer = setInterval(() => { if (draftGhostState(draft, Date.now()).shown || set.object.visible) invalidate(); }, 1000 / (draft.take.fps || 24));
		return () => clearInterval(timer);
	}, [active, draft, set, invalidate]);
	useFrame(() => frameDraft({ set, label, draft: active ? draft : null, rig, scene, objects, propTake }));
	return null;
}
