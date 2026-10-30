// The beat board's model (src/motion/beat-board-model.js): the newest draft's beats as blocks with their QA state,
// overlapping beats on separate rows, each issue's span and each goal's mark, the draft/installed modes, and a real
// motion.compile through the command bus feeding it (agent-progress.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { motionFixture } from './motion-fixture.mjs';
import { skeletonFor } from '../../src/motion3/rigs/index.js';
import { clearProgress, latestDraft } from '../../src/agent-progress.js';
import { beatBoardModel, beatLabel, blockTitle, goalText, takeIsDraft } from '../../src/motion/beat-board-model.js';

const draftOf = (over = {}) => ({
	n: 3, frames: 200, installed: false,
	qa: {
		ok: false, total: 95,
		groups: [
			{ kind: 'GOAL', subject: 'hand low', count: 1, first: 60, last: 60 },
			{ kind: 'COLLIDE', subject: 'shin_r x cube', count: 39, first: 56, last: 94 },
			{ kind: 'REACH', subject: 'arm_miss_l', count: 5, first: 150, last: 154 },
			{ kind: 'POP', subject: 'LeftForeArm', count: 1, first: 199, last: 199 },
		],
		goals: [
			{ name: 'hand low', kind: 'near', ok: false, value: 0.276, need: 0.05, at: 60 },
			{ name: 'hand at cup', kind: 'near', ok: true, value: 0.012, need: 0.02, at: 160 },
		],
	},
	timeline: [
		{ beat: 'keys', src: 'keys', f: [0, 0], events: [] },
		{ beat: 'walk', src: 'generators[0]', f: [6, 120], events: [] },
		{ beat: 'reachGrip', src: 'use[0]', f: [140, 172], events: [{ f: 150, object: 'cup', event: 'grab' }] },
		{ beat: 'reachGrip', src: 'use[1]', f: [142, 174], events: [] },
	],
	...over,
});
const take = (frames, segments) => ({ frames, segments });

test('a draft lays out its beats with their state, rows, issue spans and goal marks', () => {
	const m = beatBoardModel(draftOf(), null);
	assert.equal(m.mode, 'draft');
	assert.deepEqual([m.n, m.total, m.ok], [3, 95, false]);
	assert.deepEqual(m.blocks.map(b => [b.beat, b.f0, b.f1, b.state, b.issues, b.missed, b.row]), [
		['keys', 0, 0, 'clean', 0, 0, 0],
		['walk', 6, 120, 'goal', 1, 1, 0],
		['reachGrip', 140, 172, 'issue', 1, 0, 0],
		['reachGrip', 142, 174, 'issue', 1, 0, 1],
	], 'the walk holds the collision and the missed goal; the two hands overlap, so the second takes row 1');
	assert.ok(m.blocks.every(b => b.rows === 2));
	assert.deepEqual(m.blocks[2].goals.map(g => g.name), ['hand at cup'], 'a met goal inside a beat is listed there');
	assert.equal(m.blocks[2].state, 'issue', 'a met goal does not hide an issue');
	assert.deepEqual(m.spans.map(s => [s.f0, s.f1]), [[56, 94], [150, 154], [199, 199]], 'every issue other than GOAL draws its span, even outside a beat');
	assert.deepEqual(m.marks.map(k => [k.f, k.ok]), [[60, false], [160, true]]);
	assert.equal(beatBoardModel({ ...draftOf(), timeline: [] }, null), null, 'no beats, no board');
	assert.equal(beatBoardModel(null, null), null);
});

test('installed: shown only while the timeline take is the draft as compiled', () => {
	const installed = draftOf({ installed: true });
	const one = [{ id: 's', timelineStart: 0, timelineEnd: 199, speed: 1 }];
	assert.equal(takeIsDraft(take(200, one), installed), true);
	assert.equal(beatBoardModel(installed, take(200, one)).mode, 'installed');
	assert.equal(beatBoardModel(installed, null), null, 'no take on the timeline');
	assert.equal(beatBoardModel(installed, take(180, [{ id: 's', timelineStart: 0, timelineEnd: 179, speed: 1 }])), null, 'a trimmed or other take');
	assert.equal(beatBoardModel(installed, take(200, [{ id: 's', timelineStart: 0, timelineEnd: 199, speed: 1.5 }])), null, 'a retimed take');
	assert.equal(beatBoardModel(installed, take(200, [one[0], { id: 't', timelineStart: 100, timelineEnd: 199, speed: 1 }])), null, 'a cut take');
	assert.equal(beatBoardModel(draftOf(), take(200, one)).mode, 'draft', 'a newer draft over an installed take is a draft');
});

test('more than three overlapping beats share the last row', () => {
	const timeline = Array.from({ length: 5 }, (_, i) => ({ beat: 'reachGrip', src: `use[${i}]`, f: [10, 40], events: [] }));
	const m = beatBoardModel(draftOf({ timeline }), null);
	assert.deepEqual(m.blocks.map(b => b.row), [0, 1, 2, 2, 2]);
	assert.ok(m.blocks.every(b => b.rows === 3));
});

test('labels, goal lines and tooltips', () => {
	assert.equal(beatLabel('walk'), 'Walk');
	assert.equal(beatLabel('reachGrip'), 'Reach and grip');
	assert.equal(beatLabel('liftBox'), 'liftBox', 'an unknown skill keeps its name');
	assert.equal(goalText({ name: 'hand low', kind: 'near', ok: false, value: 0.276, need: 0.05 }), '✗ hand low 27.6 cm (≤ 5 cm)');
	assert.equal(goalText({ name: 'seated', kind: 'above', ok: true, value: 0.158, need: 0.14 }), '✓ seated 0.158 (≥ 0.14)');
	const title = blockTitle(beatBoardModel(draftOf(), null).blocks[2]);
	assert.match(title, /^Reach and grip · frames 140–172/);
	assert.match(title, /⚠ REACH arm_miss_l \(frames 150–154\)/);
	assert.match(title, /✓ hand at cup 1\.2 cm/);
	assert.match(title, /grab cup f150/);
});

test('a real motion.compile draft feeds the board', () => {
	clearProgress();
	const f = motionFixture();
	try {
		const model = f.cast.read().find(row => row.id === 'actor-a').model;
		const sk = skeletonFor(model), I = sk.index, P = sk.restWorldPos, ank = P[I.LeftFoot][1];
		const spec = { schema: 'cozyclay.motion-spec.v1', fps: 24, frames: 160,
			keys: [{ f: 0, set: { root: [0, P[I.Hips][1] - 0.01, 0], yaw: 0, foot_l: [0.09, ank, -0.03], foot_r: [-0.09, ank, 0.03], fyaw_l: 0, fyaw_r: 0 } }],
			generators: [{ type: 'walk', f0: 6, steps: 4, heading: [0, 0] }],
			goals: [{ name: 'hand at head', near: ['joint:LeftHand', 'joint:Head'], tol: 0.02, at: 140 }] };
		const r = f.run('motion.compile', { characterId: 'actor-a', spec, install: 'never' }, 'agent');
		assert.equal(r.ok, true, JSON.stringify(r));
		const m = beatBoardModel(latestDraft('actor-a'), null);
		assert.equal(m.mode, 'draft');
		assert.equal(m.n, 1);
		assert.equal(m.total, r.output.qa.total);
		const walk = m.blocks.find(b => b.beat === 'walk');
		assert.ok(walk && walk.f0 === 6 && walk.f1 > walk.f0, JSON.stringify(m.blocks));
		assert.deepEqual(m.marks.map(k => [k.f, k.ok]), [[140, false]], 'the missed goal outside the walk is a mark at its frame');
	} finally { f.dispose(); clearProgress(); }
});
