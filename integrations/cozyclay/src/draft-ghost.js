// The agent's latest motion draft as one translucent figure in the working views, so the user sees the motion
// take shape while the agent works (agent-progress.js publishes every motion.compile, installed or not). This
// module holds the pure choices: whether the ghost shows, at what opacity and frame (its own loop at the take's
// rate from the moment the draft arrived, whatever the timeline does), what its label says, and the viewer's
// on/off setting (transient like the View menu: never saved, never undone). draft-ghost.jsx draws it on
// GIZMO_LAYER, so captures, contact sheets and exports never see it.
import { useSyncExternalStore } from "react";
import { ko } from "./locale.js";
import { qaLabel } from "./qa-label.js";

/** Teal: apart from the onion skin's blue (before) and orange (after). */
export const DRAFT_GHOST_COLOR = "#2fc79a";
export const DRAFT_GHOST_OPACITY = 0.42;
/** An installed draft fades out over this long from its arrival: the real take plays now. */
export const DRAFT_GHOST_FADE_MS = 1200;
const HIDDEN = Object.freeze({ shown: false, opacity: 0, frame: 0 });

/**
 * draftGhostState(draft, now) -> { shown, opacity, frame }: a draft whose take is a take v3 shows at
 * DRAFT_GHOST_OPACITY while it is not installed; an installed one fades out over DRAFT_GHOST_FADE_MS.
 * frame loops over the take at its fps from draft.at (ms, as now).
 */
export function draftGhostState(draft, now) {
	const take = draft?.take;
	if (take?.schema !== "cozyclay.take.v3" || !(take.frameCount > 0)) return HIDDEN;
	const age = Math.max(0, now - (draft.at ?? now)), fps = take.fps > 0 ? take.fps : 24;
	const opacity = draft.installed ? DRAFT_GHOST_OPACITY * (1 - age / DRAFT_GHOST_FADE_MS) : DRAFT_GHOST_OPACITY;
	if (!(opacity > 0.01)) return HIDDEN;
	return { shown: true, opacity: +opacity.toFixed(3), frame: Math.floor((age / 1000) * fps) % take.frameCount };
}

/** "Draft 3 · 2 problems" ("초안 3 · 문제 2개"), "Draft 7 · QA clean": problems, not frame-level issues (qa-label.js). */
export const draftLabel = draft => `${ko("Draft", "초안")} ${draft?.n ?? 0} · ${qaLabel(draft?.qa)}`;

let shown = true;
const listeners = new Set();
/** Whether the viewer wants the draft ghost (default on). */
export const draftGhostShown = () => shown;
export function setDraftGhostShown(value) {
	const next = !!value;
	if (next === shown) return shown;
	shown = next;
	for (const listener of [...listeners]) listener();
	return shown;
}
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const useDraftGhostShown = () => useSyncExternalStore(subscribe, draftGhostShown, draftGhostShown);
