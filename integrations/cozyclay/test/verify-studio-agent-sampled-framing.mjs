import assert from "node:assert/strict";
import { readStudioFunction } from "./bus/verify-domain-modules.mjs";
import { framingChecks, sampledFramingChecks } from "../src/studio-agent-commands.js";
import { sampleAt } from "../src/sample-at.js";
import { shotAtFrame } from "../src/cuts.js";
import { fovToFocalMm } from "../src/shot.js";

const scene = {
  frame: 0,
  frameCount: 48,
  floorY: 0,
  objects: [{ id: "subject", name: "Subject", renderer: "cube", x: 0, y: 0, z: 0, rotX: 0, rot: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, footprint: { width: 1, depth: 1 }, height: 1, hidden: false }],
  characters: [],
  camera: { position: { x: 0, y: 1, z: 5 }, lookAt: { x: 0, y: 0.5, z: 0 }, focalMm: 35, sensorId: "fullFrame" },
  filmback: { sensorId: "fullFrame", aspectRatio: 16 / 9 },
};
const ports = {
  bounds() { throw new Error("static primitive does not use evaluated bounds"); },
  sampleStateAt(frame, state) {
    return frame < 24 ? state : { ...state, frame, objects: [{ ...state.objects[0], x: 100 }] };
  },
};

const current = framingChecks(["subject"], scene, ports);
assert.equal(current.clipped, false, "the first frame fits");
const result = sampledFramingChecks(["subject"], scene, ports, [0, 24, 47]);
assert.equal(result.coverage, "sampled-timeline-subject-bounds-projection");
assert.deepEqual(result.sampledFrames, [0, 24, 47]);
assert.equal(result.sampledChecks.length, 3);
assert.equal(typeof result.sampledChecks[0].screenFraction, "number");
assert.deepEqual(result.issueFrames.map(({ frame }) => frame), [24, 47]);
assert.equal(result.evaluatedFrames, 3);

// Execute the App port itself with the envelope the binding sends to it.
const samplerSource = readStudioFunction("sampleStudioStateAt");
const playbackScene = { frameCount: 48, filmback: scene.filmback };
const forwardFrom = (yaw, pitch) => ({
  x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch),
});
const sampleStateAt = new Function(
  "sampleAt", "shotAtFrame", "fovToFocalMm", "forwardFrom", "playbackScene",
  `${samplerSource}; return sampleStudioStateAt;`,
)(sampleAt, shotAtFrame, fovToFocalMm, forwardFrom, playbackScene);
const bindingScene = {
  ...scene,
  shotDocument: { shots: [{
    id: "camera-move", startFrame: 0, endFrame: 47, camera: { mode: "keys" },
    cameraKeys: [0, 47].map(frame => ({
      frame, framing: { pos: { x: frame ? 100 : 0, y: 1, z: 5 }, yaw: 0, pitch: 0, fovDeg: 45 },
    })),
  }] },
};
const before = structuredClone(bindingScene);
assert.equal(sampleStateAt(47, bindingScene).camera.position.x, 100, "sampled camera must use the binding's shot document");
const cameraResult = sampledFramingChecks(["subject"], bindingScene, { sampleStateAt }, [0, 47]);
assert.deepEqual(cameraResult.issueFrames.map(({ frame }) => frame), [47], "a keyed camera moving away from the subject must fail its last sample");
assert.deepEqual(bindingScene, before, "verification must not mutate the current scene or camera");
console.log("verify-studio-agent-sampled-framing: ok");
