// Ambient occlusion for the stage look (stage.lighting.ao): contact darkening
// where a body meets the floor or a prop, and in creases (an armpit, the back of
// a knee in a squat). Screen space, because the bodies are skinned and move: a
// baked aoMap cannot follow a skinned mesh, and contact blobs under the feet
// miss every crease.
//
// One hook on the scene (scene.onAfterRender) runs it after each draw of the
// stage through a perspective camera, so every path gets it with no code of its
// own: the viewport panes, the shot preview card, capture_frame, contact sheets
// and video export (stage-capture.jsx renders the same scene into its target).
// A draw with an override material (the outline prepass, the depth and normal
// plates) is left alone, and so is the orthographic plan.
//
// Per draw, at half resolution past 960 px wide: a depth-only prepass of the
// opaque set, the occlusion within AO_RADIUS of each pixel from SAMPLES samples
// (how far each sample's direction rises above the surface the depth holds,
// weighted toward the near ones and faded with the fog), a depth-aware 5x5
// blur, then a multiply over the frame just drawn. The prepass reuses the
// shadow maps the draw already made. On an Apple M4 Pro it adds about 0.4 ms of
// GPU time to a 1920x1080 export frame.
import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { GIZMO_LAYER, POSER_LAYER } from "./dualview.jsx";

const AO_RADIUS = 0.4;
const SAMPLES = 16;
// A sample whose direction rises less than this cosine above the normal is the
// same surface (floor noise at grazing angles), not an occluder.
const BIAS = 0.15;
// Occlusion to darkening, tuned by eye on the clay figure (a squat's creases, feet on the deck).
const GAIN = 3;
// Size buckets kept alive at once (the main pane, the preview card, the exports).
const CACHED_SIZES = 4;

const VERTEX = "varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const OCCLUSION = `
uniform sampler2D tDepth;
uniform mat4 projection;
uniform mat4 inverseProjection;
uniform vec2 size;
uniform vec2 fog;
varying vec2 vUv;
vec3 viewAt(vec2 uv, float depth) {
	vec4 p = inverseProjection * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
	return p.xyz / p.w;
}
vec3 viewAt(vec2 uv) { return viewAt(uv, texture2D(tDepth, uv).x); }
void main() {
	float depth = texture2D(tDepth, vUv).x;
	if (depth >= 1.0) { gl_FragColor = vec4(1.0); return; }
	vec3 p = viewAt(vUv, depth);
	// The normal of the surface the depth buffer holds (each axis from the nearer
	// neighbour, so an edge does not bend it): flat facets of the low-poly clay
	// then occlude nothing of their own, whatever their smoothed shading normal says.
	vec2 texel = 1.0 / size;
	vec3 right = viewAt(vUv + vec2(texel.x, 0.0)) - p, left = p - viewAt(vUv - vec2(texel.x, 0.0));
	vec3 up = viewAt(vUv + vec2(0.0, texel.y)) - p, down = p - viewAt(vUv - vec2(0.0, texel.y));
	vec3 n = normalize(cross(abs(right.z) < abs(left.z) ? right : left, abs(up.z) < abs(down.z) ? up : down));
	float reach = min(${AO_RADIUS.toFixed(2)} * projection[1][1] * 0.5 * size.y / -p.z, size.y * 0.2);
	float fade = 1.0 - smoothstep(fog.x, fog.y, -p.z);
	if (reach < 1.0 || fade <= 0.0) { gl_FragColor = vec4(1.0); return; }
	float spin = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
	// A weighted mean over the samples near the surface (weight falls to 0 at RADIUS),
	// so an occluder close by counts fully however small it is on screen.
	float occlusion = 0.0, weights = 0.25;
	for (int i = 0; i < ${SAMPLES}; i++) {
		float angle = float(i) * 2.39996323 + spin;
		// snapped to a texel centre, so the depth read and the position rebuilt from it agree
		vec2 uv = (floor((vUv + vec2(cos(angle), sin(angle)) * ((float(i) + 0.5) / ${SAMPLES}.0) * reach / size) * size) + 0.5) / size;
		vec3 v = viewAt(uv) - p;
		float distance = length(v), weight = pow(max(0.0, 1.0 - distance / ${AO_RADIUS.toFixed(2)}), 2.0);
		occlusion += max(dot(v, n) / max(distance, 1e-4) - ${BIAS.toFixed(2)}, 0.0) * weight;
		weights += weight;
	}
	float ao = clamp(1.0 - ${GAIN.toFixed(2)} * occlusion / (weights * ${(1 - BIAS).toFixed(2)}), 0.0, 1.0);
	gl_FragColor = vec4(vec3(mix(1.0, ao, fade)), 1.0);
}`;
const BLUR = `
#include <packing>
uniform sampler2D tOcclusion;
uniform sampler2D tDepth;
uniform vec2 size;
uniform vec2 clip;
varying vec2 vUv;
float viewZ(vec2 uv) { return perspectiveDepthToViewZ(texture2D(tDepth, uv).x, clip.x, clip.y); }
void main() {
	float z = viewZ(vUv), total = 0.0, weights = 0.0;
	for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
		vec2 uv = vUv + vec2(float(x), float(y)) / size;
		float weight = 1.0 - smoothstep(0.02, 0.06, abs(viewZ(uv) - z) / -z);
		total += texture2D(tOcclusion, uv).r * weight;
		weights += weight;
	}
	gl_FragColor = vec4(vec3(total / max(weights, 1e-4)), 1.0);
}`;
const COMPOSITE = `
uniform sampler2D tOcclusion;
uniform float strength;
varying vec2 vUv;
void main() { gl_FragColor = vec4(vec3(mix(1.0, texture2D(tOcclusion, vUv).r, strength)), 1.0); }`;

const pass = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false, ...extra });
const target = (width, height, filter, depth = false) => new THREE.WebGLRenderTarget(width, height, {
	minFilter: filter, magFilter: filter, depthBuffer: depth, generateMipmaps: false,
	...(depth ? { depthTexture: Object.assign(new THREE.DepthTexture(width, height, THREE.UnsignedIntType), { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }) } : {}),
});
// What the prepass leaves out: light rather than surface (glow halos, smoke,
// see-through and faded parts, ghosts), picture cards whose alpha a solid
// depth pass would ignore, lines and points.
const seeThrough = (material) => [material].flat().some((m) => m && (m.transparent || m.depthWrite === false));
const leftOut = (node) => node.userData?.beautyOnly || node.userData?.cutoutTexture !== undefined || node.isSprite || node.isPoints || node.isLine || (node.isMesh && seeThrough(node.material));

/**
 * Put the occlusion pass on `scene`. `settings.strength` (0..1) is read at each
 * draw, so a slider changes it without rebuilding anything. Answers a function
 * that takes the hook off and frees the targets.
 */
export function installOcclusion(scene, settings) {
	// Depth is all the pass reads: the prepass writes no colour at all.
	const depthOnly = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false });
	const occlusion = pass(OCCLUSION, { tDepth: { value: null }, projection: { value: new THREE.Matrix4() }, inverseProjection: { value: new THREE.Matrix4() }, size: { value: new THREE.Vector2() }, fog: { value: new THREE.Vector2() } });
	const blur = pass(BLUR, { tOcclusion: { value: null }, tDepth: { value: null }, size: { value: new THREE.Vector2() }, clip: { value: new THREE.Vector2() } });
	const composite = pass(COMPOSITE, { tOcclusion: { value: null }, strength: { value: 1 } }, {
		blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
		blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, toneMapped: false,
	});
	const quad = new FullScreenQuad(), sizes = new Map(), viewport = new THREE.Vector4(), scissor = new THREE.Vector4();
	let running = false;
	const targetsFor = (width, height) => {
		const key = `${width}x${height}`;
		let set = sizes.get(key);
		if (set) sizes.delete(key);
		else set = { prepass: target(width, height, THREE.NearestFilter, true), raw: target(width, height, THREE.NearestFilter), smooth: target(width, height, THREE.LinearFilter) };
		sizes.set(key, set);
		if (sizes.size > CACHED_SIZES) {
			const [oldest, stale] = sizes.entries().next().value;
			sizes.delete(oldest);
			for (const t of Object.values(stale)) { t.depthTexture?.dispose(); t.dispose(); }
		}
		return set;
	};
	scene.onAfterRender = (renderer, _scene, camera) => {
		if (running || scene.overrideMaterial || !camera?.isPerspectiveCamera || !(settings.strength > 0)) return;
		running = true;
		const output = renderer.getRenderTarget(), autoClear = renderer.autoClear, background = scene.background, mask = camera.layers.mask;
		const shadows = renderer.shadowMap, shadowAuto = shadows.autoUpdate, shadowNeeds = shadows.needsUpdate;
		renderer.getViewport(viewport);
		renderer.getScissor(scissor);
		const pixels = renderer.getCurrentViewport(new THREE.Vector4()), half = pixels.z > 960 ? 0.5 : 1;
		const width = Math.max(1, Math.round(pixels.z * half)), height = Math.max(1, Math.round(pixels.w * half));
		const { prepass, raw, smooth } = targetsFor(width, height), hidden = [];
		try {
			scene.traverse((node) => { if (node.visible && leftOut(node)) { hidden.push(node); node.visible = false; } });
			scene.background = null;
			scene.overrideMaterial = depthOnly;
			camera.layers.disable(GIZMO_LAYER);
			camera.layers.disable(POSER_LAYER);
			shadows.autoUpdate = false;
			renderer.autoClear = true;
			renderer.setRenderTarget(prepass);
			renderer.render(scene, camera);
			for (const node of hidden.splice(0)) node.visible = true;
			scene.background = background;
			scene.overrideMaterial = null;
			camera.layers.mask = mask;
			const u = occlusion.uniforms, b = blur.uniforms, fog = scene.fog;
			u.tDepth.value = b.tDepth.value = prepass.depthTexture;
			u.projection.value.copy(camera.projectionMatrix);
			u.inverseProjection.value.copy(camera.projectionMatrixInverse);
			u.size.value.set(width, height);
			u.fog.value.set(fog?.near ?? 1e5, fog?.far ?? 2e5);
			renderer.setRenderTarget(raw);
			quad.material = occlusion;
			quad.render(renderer);
			b.tOcclusion.value = raw.texture;
			b.size.value.set(width, height);
			b.clip.value.set(camera.near, camera.far);
			renderer.setRenderTarget(smooth);
			quad.material = blur;
			quad.render(renderer);
			composite.uniforms.tOcclusion.value = smooth.texture;
			composite.uniforms.strength.value = Math.min(1, settings.strength);
			renderer.setRenderTarget(output);
			// The canvas takes back the pane's own viewport (setRenderTarget(null) floors it, the draw rounded it).
			if (output === null) {
				renderer.setViewport(viewport);
				renderer.setScissor(scissor);
			}
			renderer.autoClear = false;
			quad.material = composite;
			quad.render(renderer);
		} finally {
			for (const node of hidden) node.visible = true;
			if (renderer.getRenderTarget() !== output) renderer.setRenderTarget(output);
			scene.background = background;
			scene.overrideMaterial = null;
			camera.layers.mask = mask;
			shadows.autoUpdate = shadowAuto;
			shadows.needsUpdate = shadowNeeds;
			renderer.autoClear = autoClear;
			running = false;
		}
	};
	return () => {
		delete scene.onAfterRender;
		for (const set of sizes.values()) for (const t of Object.values(set)) { t.depthTexture?.dispose(); t.dispose(); }
		for (const material of [depthOnly, occlusion, blur, composite]) material.dispose();
		quad.dispose();
	};
}
