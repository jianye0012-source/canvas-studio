// The interaction bench's scenes as project documents (test/fixtures/bench/<id>.cozyclay.json): one character
// at the origin facing +Z with no take, and the scenario's objects (motion-scenarios.mjs) filled with the
// record defaults the Studio writes. `node test/bench/motion-fixtures.mjs` writes the files; the bench test
// checks that the committed files are what this builder makes.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "./motion-scenarios.mjs";

const record = o => {
	const empty = o.renderer === "empty";
	return { id: o.id, name: o.name, renderer: o.renderer, x: o.x, y: o.y, z: o.z, rot: o.rot ?? 0, rotX: 0, rotZ: 0, scaleX: o.scaleX, scaleY: o.scaleY, scaleZ: o.scaleZ,
		path: null, color: o.color, parent: o.parent ?? null, attach: null, hidden: false, footprint: empty ? { width: 0, depth: 0 } : { width: 1, depth: 1 }, height: empty ? 0 : 1, supportY: empty ? 0 : 1 };
};

const character = { id: "char-a", model: "y-bot-tpose", posture: "stand", x: 0, y: 0, z: 0, rot: 0, hidden: false, parent: null, tint: null, pose: null, identityImage: null, scale: 1,
	subject: "a person in a grey hoodie", layer: { waypoints: [] }, ikEdits: null };

const stage = { hasCharSheet: false, environmentImage: null, shotAspect: "16:9", cameraPresetId: null, sensorId: "fullFrame",
	keyLight: { x: 6, y: 9, z: 4, intensity: 1.12, warmth: 0.5, color: null },
	lighting: { preset: "studio", sky: null, skyTop: null, ambient: 1, hemiSky: "#ffffff", hemiGround: "#5a5d64", fill: 1, fog: 0, exposure: 1, shadowSoftness: 0, envLight: 0, ao: 0, hdr: null, hdrRotation: 0, hdrIntensity: 1, hdrBackground: true },
	environment: "", style: "", hasEnvSheet: false };

/** The project document of scenario `id` (savedAt fixed, so the file is stable). */
export function fixtureDocument(id) {
	const scenario = SCENARIOS[id], sceneId = `scene-bench-${id.toLowerCase()}`;
	return {
		app: "cozyclay", kind: "project", version: 5, name: `Bench ${id} ${scenario.title}`, previsMode: "animation", savedAt: 1792200000000,
		scenes: { version: 5, activeSceneId: sceneId, scenes: [{ id: sceneId, name: "SCENE 01", objects: scenario.objects.map(record),
			shotDocument: { version: 5, frameCount: 240, waypoints: [], shots: [] }, stage: { ...stage, characters: [{ ...character }] }, order: 0 }] },
		workspace: { hierarchyWidth: 300, sidebarWidth: 380, timelineHeight: 224, insetWidth: 310, insetHeight: 310, insetCollapsed: false, planZoom: 1 },
		poseLibrary: [], workflow: { version: 1, nodes: [], edges: [] }, resources: { assets: [] },
	};
}

/** Where scenario `id`'s fixture lives, relative to the repository root. */
export const fixturePath = id => `test/fixtures/bench/${id}.cozyclay.json`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	for (const id of Object.keys(SCENARIOS)) {
		writeFileSync(new URL(`../../${fixturePath(id)}`, import.meta.url), `${JSON.stringify(fixtureDocument(id), null, "\t")}\n`);
		console.log("wrote", fixturePath(id));
	}
}
