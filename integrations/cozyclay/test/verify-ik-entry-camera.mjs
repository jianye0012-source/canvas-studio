#!/usr/bin/env node
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceRoot = process.env.COZYCLAY_ROOT
	? resolve(process.env.COZYCLAY_ROOT)
	: fileURLToPath(new URL("../", import.meta.url));
const { chooseIkEntryPose } = await import(pathToFileURL(resolve(sourceRoot, "src/ik-camera.js")).href);

const editorPose = { source: "editor" };
const shotPose = { source: "shot" };
const rememberedPose = { source: "remembered" };

assert.equal(
	chooseIkEntryPose({ rememberedPose: null, editorPose, shotPose, lookThroughShot: false }),
	editorPose,
	"a first IK entry seeds from the editor view",
);
assert.equal(
	chooseIkEntryPose({ rememberedPose, editorPose, shotPose, lookThroughShot: false }),
	rememberedPose,
	"a remembered poser view wins for the same character",
);
assert.equal(
	chooseIkEntryPose({ rememberedPose: null, editorPose, shotPose, lookThroughShot: true }),
	shotPose,
	"look-through-shot IK entry seeds from the shot view",
);
assert.equal(
	chooseIkEntryPose({ rememberedPose, editorPose, shotPose, lookThroughShot: true }),
	rememberedPose,
	"a remembered poser view still wins over look-through-shot",
);

// The motion domain reads the editor view through its own shared getters (appContext.forRender): without them
// editorPose was always null, and Pose mode opened from the poser's construction-time spot, off the character.
const { readFileSync } = await import("node:fs");
const app = readFileSync(resolve(sourceRoot, "src/App.jsx"), "utf8");
const motionShared = app.slice(app.indexOf("useMotion(appContext.forRender({"), app.indexOf("}));", app.indexOf("useMotion(appContext.forRender({")));
assert.ok(motionShared.includes("get editorCamRef()") && motionShared.includes("get editorLook()"), "the motion domain is handed the editor camera and its look");

console.log("PASS IK entry camera seeding decisions");
