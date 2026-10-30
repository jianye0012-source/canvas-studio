// frame_shot must land in the camera the export path renders. The contact
// sheet and the video export both pose the shot camera with
// sampleAt(playbackScene, shotAtFrame(shots, frame), frame) (App.jsx
// applyExportFrame); this replays a real agent turn through the App wiring and
// samples that camera at frames the playhead never visited.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotsFixture } from './shots-fixture.mjs';
import { sampleAt } from '../../src/sample-at.js';
import { shotAtFrame } from '../../src/cuts.js';

const FRAME_COUNT = 360;
const exact = (position, lookAt, focalMm) => ({ exact: { position, lookAt, focalMm } });
const intent = { intent: { size: 'medium-wide shot', view: 'front three-quarter', level: 'low', side: 'left' } };
const second = exact({ x: 1.5, y: 0.85, z: 2.3 }, { x: 0, y: 0.6, z: 0 }, 40);
const third = exact({ x: 2.6, y: 1, z: 4 }, { x: 0, y: 0.55, z: 0 }, 35);

function agentTurn() {
  const f = shotsFixture();
  f.shots.load({ shots: [], frameCount: FRAME_COUNT, camera: f.actual.readStudioState().camera });
  f.live.current.timeline.currentFrame = 0;
  const step = (id, args = {}) => {
    const receipt = f.run(id, args, 'agent');
    assert.equal(receipt.ok, true, `${id}: ${JSON.stringify(receipt)}`);
    return receipt;
  };
  const exportCamera = frame => {
    const state = f.actual.readStudioState(), subject = state.characters.find(row => row.id === 'actor-a');
    const scene = { frameCount: FRAME_COUNT, subject, cameraAnchor: subject, filmback: state.filmback };
    return sampleAt(scene, shotAtFrame(f.live.current.shots, frame), frame).camera;
  };
  return { f, step, exportCamera, live: () => f.actual.readStudioState().camera };
}

// The pose a framing asks for, in the shape sampleAt answers.
function assertCamera(actual, framing, label) {
  const { position, lookAt, focalMm } = framing.exact;
  const dx = lookAt.x - position.x, dy = lookAt.y - position.y, dz = lookAt.z - position.z;
  assert.ok(actual, `${label}: the export path has no shot camera`);
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(actual.pos[axis] - position[axis]) < 1e-9, `${label}: ${JSON.stringify(actual.pos)} is not ${JSON.stringify(position)}`);
  assert.ok(Math.abs(actual.yaw - Math.atan2(-dx, -dz)) < 1e-9, `${label}: yaw ${actual.yaw}`);
  assert.ok(Math.abs(actual.pitch - Math.atan2(dy, Math.hypot(dx, dz))) < 1e-9, `${label}: pitch ${actual.pitch}`);
  assert.ok(Math.abs(actual.focalMm - focalMm) < 1e-6, `${label}: focal ${actual.focalMm}`);
}
const samePosition = (a, b) => ['x', 'y', 'z'].every(axis => Math.abs(a[axis] - b[axis]) < 1e-9);

test('the export camera at every frame is the last frame_shot framing of a held shot', () => {
  const { f, step, exportCamera, live } = agentTurn();
  try {
    const shotId = step('shot.create').affectedIds[0];
    const createdKey = f.live.current.shots[0].cameraKeys[0];
    assert.ok(createdKey, 'shot.create keeps the framing on screen as the shot\'s key');
    step('shot.setRange', { shotId, range: { startFrame: 0, endFrameExclusive: 265 } });

    step('shot.frame', { shotId, subjectIds: ['actor-a'], framing: intent, caption: 'squatting at night' });
    const framed = live();
    assert.ok(!samePosition(framed.position, createdKey.framing.pos), 'the intent framing moved the camera');
    for (const frame of [10, 120, 200]) assert.ok(samePosition(exportCamera(frame).pos, framed.position), `intent framing at frame ${frame}`);

    step('shot.frame', { shotId, subjectIds: ['actor-a'], framing: second });
    for (const frame of [10, 200]) assertCamera(exportCamera(frame), second, `second framing at frame ${frame}`);

    step('view.update', { frame: 120, shotId, view: { lookThrough: true } });
    assert.equal(f.actual.readStudioState().view.frame, 120);
    step('shot.frame', { shotId, subjectIds: ['actor-a'], framing: third });
    for (const frame of [10, 120, 200]) assertCamera(exportCamera(frame), third, `third framing at frame ${frame}`);
    assert.ok(samePosition(live().position, third.exact.position), 'the live shot view shows the same framing');

    const [shot] = f.live.current.shots;
    assert.deepEqual(shot.cameraKeys.map(key => [key.id, key.frame]), [[createdKey.id, 0]], 'a held shot keeps one key, reframed in place');
    assert.equal(shot.camera.mode, 'keys');
    assert.equal(f.scope.manualCameraOverrideRef.current, false, 'the keys, not a manual override, drive the live shot camera');
  } finally { f.dispose(); }
});

test('a camera move keeps its keys: keyAtFrame adds one, and a plain frame_shot keys the playhead', () => {
  const { f, step, exportCamera } = agentTurn();
  try {
    const shotId = step('shot.create').affectedIds[0];
    step('shot.setRange', { shotId, range: { startFrame: 0, endFrameExclusive: 265 } });
    step('shot.frame', { shotId, subjectIds: ['actor-a'], framing: second });
    const keyAtZero = f.live.current.shots[0].cameraKeys[0];

    step('shot.frame', { shotId, subjectIds: ['actor-a'], framing: third, keyAtFrame: 200 });
    assert.deepEqual(f.live.current.shots[0].cameraKeys.map(key => key.frame), [0, 200]);
    assert.deepEqual(f.live.current.shots[0].cameraKeys[0], keyAtZero, 'the earlier key is untouched');
    assertCamera(exportCamera(0), second, 'move start');
    assertCamera(exportCamera(200), third, 'move end');
    assert.ok(!samePosition(exportCamera(100).pos, second.exact.position) && !samePosition(exportCamera(100).pos, third.exact.position), 'the camera travels between the keys');

    step('view.update', { frame: 120, shotId });
    const middle = exact({ x: -2, y: 1.4, z: 3 }, { x: 0, y: 1, z: 0 }, 50);
    step('shot.frame', { shotId, subjectIds: ['actor-a'], framing: middle });
    assert.deepEqual(f.live.current.shots[0].cameraKeys.map(key => key.frame), [0, 120, 200]);
    assertCamera(exportCamera(120), middle, 'the playhead key');
    assertCamera(exportCamera(0), second, 'move start after the playhead key');
    assertCamera(exportCamera(200), third, 'move end after the playhead key');
  } finally { f.dispose(); }
});
