// What the agent's motion work looks like while it runs, for the user's eyes. Every motion.compile publishes its
// draft here, installed or not: the take it baked, its QA (total, groups, goals) and its beats (timeline). The
// images the agent asks to see (verify_result) are published here too. The viewport plays the latest draft as a
// ghost, the timeline lays out its beats, and the agent panel draws the QA trend, the goals and the images.
// In-page only: nothing here is saved with the project, undone, or sent to the agent. Each character keeps its
// last KEEP drafts; the images keep the last KEEP. A new agent turn starts clean (clearProgress).

import { qaProblems } from "./qa-label.js";
const KEEP = 12;
const drafts = new Map(), sheets = [], listeners = new Set();
let version = 0, counter = 0;

function emit() {
	version++;
	for (const listener of [...listeners]) {
		try { listener(); } catch { /* a broken view never stops the agent */ }
	}
}

const pick = (row, keys) => Object.fromEntries(keys.filter(k => row?.[k] !== undefined).map(k => [k, row[k]]));

/**
 * publishDraft(characterId, { take, installed, specId, label, qa, timeline }) -> the stored draft:
 * { n (1, 2, ... per character), at (ms), characterId, take, frames, installed, specId, label,
 *   qa: { ok, total, problems, groups: [{ kind, subject, count, first, last, worst }], goals: [{ name, kind, ok, value, need, at }] },
 *   timeline: the compile's beats (pipeline.js timelineOf) }.
 */
export function publishDraft(characterId, { take, installed = false, specId = null, label = null, qa = null, timeline = [] }) {
	const list = drafts.get(characterId) ?? [];
	const draft = Object.freeze({
		n: (list.at(-1)?.n ?? 0) + 1, at: Date.now(), seq: ++counter, characterId, take, frames: take?.frameCount ?? 0,
		installed: !!installed, specId, label,
		qa: { ok: !!qa?.ok, total: qa?.total ?? 0, problems: qaProblems(qa),
			groups: (qa?.groups ?? []).map(g => pick(g, ["kind", "subject", "count", "first", "last", "worst"])),
			goals: (qa?.goals ?? []).map(g => pick(g, ["name", "kind", "ok", "value", "need", "at"])) },
		timeline: timeline ?? [],
	});
	drafts.set(characterId, [...list, draft].slice(-KEEP));
	emit();
	return draft;
}

/** The drafts of a character, oldest first (at most KEEP). */
export const draftsOf = characterId => drafts.get(characterId) ?? [];

/** The newest draft of a character, or of any character when none is named; null when there is none. */
export function latestDraft(characterId) {
	if (characterId !== undefined) return draftsOf(characterId).at(-1) ?? null;
	let best = null;
	for (const list of drafts.values()) if (list.length && (!best || list.at(-1).seq > best.seq)) best = list.at(-1);
	return best;
}

/** publishSheet({ characterId, dataUrl, width, height, caption, frames }) -> the stored image record. */
export function publishSheet({ characterId = null, dataUrl, width = 0, height = 0, caption = "", frames = [] }) {
	const sheet = Object.freeze({ at: Date.now(), seq: ++counter, characterId, dataUrl, width, height, caption, frames });
	sheets.push(sheet);
	sheets.splice(0, Math.max(0, sheets.length - KEEP));
	emit();
	return sheet;
}

/** The published images, oldest first (at most KEEP). */
export const progressSheets = () => [...sheets];

/** Forget every draft and image (a new agent turn). */
export function clearProgress() {
	drafts.clear();
	sheets.length = 0;
	emit();
}

/** subscribeProgress(listener) -> unsubscribe; with progressVersion it fits React's useSyncExternalStore. */
export function subscribeProgress(listener) {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

/** A number that changes on every publish or clear. */
export const progressVersion = () => version;
