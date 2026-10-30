// draft-ghost.js: the agent's latest draft shows as a ghost while it is not installed, looping on its own
// clock at the take's rate; an installed draft fades out; the label names the draft and its QA problems; the
// viewer's switch is a transient setting. The drawing itself is checked in the browser
// (scratchpad QA: the ghost on GIZMO_LAYER is absent from captures).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRAFT_GHOST_FADE_MS, DRAFT_GHOST_OPACITY, draftGhostShown, draftGhostState, draftLabel, setDraftGhostShown } from '../../src/draft-ghost.js';
import { clearProgress, latestDraft, publishDraft } from '../../src/agent-progress.js';
import { qaProblems, qaSay } from '../../src/qa-label.js';

const take = (frameCount = 48, fps = 24) => ({ schema: 'cozyclay.take.v3', frameCount, fps });

test('a draft that is not installed shows at full ghost opacity, looping at the take rate from its arrival', () => {
	const draft = { n: 2, at: 10_000, take: take(48), installed: false, qa: { total: 31 } };
	assert.deepEqual(draftGhostState(draft, 10_000), { shown: true, opacity: DRAFT_GHOST_OPACITY, frame: 0 });
	assert.equal(draftGhostState(draft, 10_500).frame, 12, 'half a second is 12 frames at 24 fps');
	assert.equal(draftGhostState(draft, 12_000).frame, 0, 'two seconds wraps a 48-frame take');
	assert.equal(draftGhostState(draft, 12_125).frame, 3);
	assert.equal(draftGhostState({ ...draft, take: take(30, 30) }, 10_500).frame, 15, 'the take fps sets the rate');
	assert.equal(draftGhostState(draft, 9_000).frame, 0, 'a clock before arrival reads as arrival');
});

test('an installed draft fades out over the fade time and is then gone', () => {
	const draft = { n: 5, at: 0, take: take(), installed: true, qa: { total: 0 } };
	const start = draftGhostState(draft, 0), half = draftGhostState(draft, DRAFT_GHOST_FADE_MS / 2);
	assert.equal(start.shown, true);
	assert.equal(start.opacity, DRAFT_GHOST_OPACITY);
	assert.ok(Math.abs(half.opacity - DRAFT_GHOST_OPACITY / 2) < 0.002, `half way ${half.opacity}`);
	assert.deepEqual(draftGhostState(draft, DRAFT_GHOST_FADE_MS), { shown: false, opacity: 0, frame: 0 });
	assert.equal(draftGhostState(draft, DRAFT_GHOST_FADE_MS * 3).shown, false);
});

test('nothing to show without a take v3', () => {
	for (const draft of [null, undefined, {}, { take: null }, { take: { schema: 'other', frameCount: 10 } }, { take: take(0) }]) {
		assert.equal(draftGhostState(draft, 0).shown, false, JSON.stringify(draft));
	}
});

test('the label names the draft and its problems, not its frame-level issues (English default)', () => {
	// one goal missed on 321 frames read "QA 321" (the user saw "QA 549" for two long groups)
	assert.equal(draftLabel({ n: 3, qa: { ok: false, total: 321, problems: 1 } }), 'Draft 3 · 1 problem');
	assert.equal(draftLabel({ n: 4, qa: { ok: false, total: 549, problems: 2 } }), 'Draft 4 · 2 problems');
	assert.equal(draftLabel({ n: 7, qa: { ok: true, total: 0, problems: 0 } }), 'Draft 7 · QA clean');
	// a result from before problems existed counts its groups
	assert.equal(draftLabel({ n: 5, qa: { ok: false, total: 40, groups: [{}, {}, {}] } }), 'Draft 5 · 3 problems');
});

test('a receipt says problems and the frame-level count', () => {
	assert.equal(qaSay({ ok: false, total: 321, problems: 1 }), '1 problem (321 frame issues)');
	assert.equal(qaSay({ ok: true, total: 0, problems: 0 }), 'clean');
	assert.equal(qaProblems({ total: 7 }), 7, 'with neither problems nor groups, the total is all there is');
	assert.equal(qaProblems({ ok: false, total: 5, groups: [] }), 5, 'a failed result never counts as no problems');
});

test('the newest published draft drives the ghost; installing it fades it; a clear removes it', () => {
	clearProgress();
	publishDraft('actor-a', { take: take(), installed: false, qa: { ok: false, total: 12, problems: 2, groups: [{ kind: 'GOAL', subject: 'a', count: 10 }, { kind: 'POP', subject: 'b', count: 2 }] } });
	const first = latestDraft();
	assert.equal(draftGhostState(first, first.at).shown, true);
	assert.equal(first.qa.problems, 2, 'the stored draft keeps the problem count');
	assert.equal(draftLabel(first), 'Draft 1 · 2 problems');
	// an older caller's result (ok false, a total, neither problems nor groups) must not read as clean
	publishDraft('actor-a', { take: take(), installed: false, qa: { ok: false, total: 12 } });
	assert.equal(latestDraft().qa.problems, 12);
	assert.equal(draftLabel(latestDraft()), 'Draft 2 · 12 problems');
	publishDraft('actor-a', { take: take(), installed: true, qa: { ok: true, total: 0 } });
	const second = latestDraft();
	assert.equal(second.n, 3);
	assert.equal(draftGhostState(second, second.at + DRAFT_GHOST_FADE_MS).shown, false, 'the installed draft is gone after the fade');
	clearProgress();
	assert.equal(draftGhostState(latestDraft(), Date.now()).shown, false);
});

test('the viewer switch is on by default and toggles', () => {
	assert.equal(draftGhostShown(), true);
	assert.equal(setDraftGhostShown(false), false);
	assert.equal(draftGhostShown(), false);
	assert.equal(setDraftGhostShown(true), true);
});
