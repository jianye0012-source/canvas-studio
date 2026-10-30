#!/usr/bin/env node
/**
 * Render the start-screen template thumbnails from the real studio.
 *
 *   npm run dev -- --port 5180            # any running dev server
 *   node tools/render-start-thumbs.mjs [--url http://127.0.0.1:5180/app/] [--out public/thumbs]
 *
 * For each template (Blank Stage plus every entry in STARTER_SCENES) and each
 * theme, this opens the studio in a fresh headless Chrome profile, creates the
 * project the way a user does (Blank Stage: the chooser's Create button; a
 * starter: `?scene=<id>`), renders one offscreen frame through the studio's own
 * capture path (`window.__cozyclay.captureFraming`), and writes
 * `<out>/<template-id>-<theme>.webp` at 680x383 (2x the 340px preview).
 * The chooser picks the file by id and theme and falls back to a plain tile
 * when it is missing, so a new starter only needs this script re-run. A
 * starter with no entry in FRAMINGS is shot through its own shot camera.
 *
 * Options: --url, --out, --cdp-port (default 9472), --only <template-id>.
 * CHROME_PATH picks the browser; THUMBS_CHROME_FLAGS replaces the GPU flags
 * (default: Metal on macOS, SwiftShader elsewhere).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnOwned, terminateOwned } from "./process-supervisor.mjs";
import { STARTER_SCENES } from "../src/starter-scenes.js";
import { THEMES, THEME_KEY } from "../src/theme.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WIDTH = 680;
const HEIGHT = 383;
const MAX_BYTES = 60 * 1024;

function arg(name, fallback) {
	const argv = process.argv.slice(2);
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : fallback;
}
const appUrl = new URL(arg("--url", "http://127.0.0.1:5180/app/"));
const outDir = resolve(ROOT, arg("--out", "public/thumbs"));
const cdpPort = Number(arg("--cdp-port", 9472));
const only = arg("--only", null);
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const gpuFlags = (process.env.THUMBS_CHROME_FLAGS
	?? (process.platform === "darwin" ? "--use-angle=metal --ignore-gpu-blocklist" : "--use-angle=swiftshader --enable-unsafe-swiftshader"))
	.split(/\s+/).filter(Boolean);

/** A studio framing ({ pos, yaw, pitch, fovDeg }) from an eye point and a target. */
function lookAt(eye, target, fovDeg) {
	const [dx, dy, dz] = target.map((value, index) => value - eye[index]);
	return { pos: { x: eye[0], y: eye[1], z: eye[2] }, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), fovDeg };
}

// Eye-level 3/4 view. Blank Stage: the default character on the floor grid.
const FRAMINGS = {
	"blank-stage": lookAt([1.6, 1.55, 3.7], [0, 0.88, 0], 40),
};

const templates = [
	{ id: "blank-stage", url: appUrl.href, create: true },
	...STARTER_SCENES.map((scene) => ({ id: scene.id, url: `${appUrl.href}?scene=${encodeURIComponent(scene.id)}`, create: false })),
].filter((template) => !only || template.id === only);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function connect() {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
			const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
			if (page) {
				const ws = new WebSocket(page.webSocketDebuggerUrl);
				await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
				return ws;
			}
		} catch {
			// Chrome is still starting.
		}
		await sleep(150);
	}
	throw new Error("headless Chrome did not expose a page target");
}

function client(ws) {
	let nextId = 1;
	const pending = new Map();
	ws.onmessage = (event) => {
		const message = JSON.parse(event.data);
		const entry = pending.get(message.id);
		if (!entry) return;
		pending.delete(message.id);
		if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
		else entry.resolve(message.result);
	};
	const send = (method, params = {}) => new Promise((resolveSend, reject) => {
		const id = nextId++;
		pending.set(id, { resolve: resolveSend, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});
	const evaluate = async (expression) => {
		const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
		return result.result.value;
	};
	const waitFor = async (label, expression, timeoutMs = 30000) => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (await evaluate(`(() => { try { return Boolean(${expression}); } catch { return false; } })()`)) return;
			await sleep(200);
		}
		throw new Error(`timed out waiting for ${label}`);
	};
	return { send, evaluate, waitFor };
}

// Runs in the page: render the framing at 2x, downscale, and encode WebP under the size cap.
const encodeInPage = (framing) => `(async () => {
	const studio = window.__cozyclay;
	const framing = ${JSON.stringify(framing)};
	const output = { width: ${WIDTH * 2}, height: ${HEIGHT * 2} };
	const png = framing ? studio.captureFraming(framing, output) : studio.capturePlate();
	if (!png) throw new Error("studio capture returned nothing");
	const image = new Image();
	image.src = png;
	await image.decode();
	const canvas = document.createElement("canvas");
	canvas.width = ${WIDTH};
	canvas.height = ${HEIGHT};
	const ctx = canvas.getContext("2d");
	ctx.imageSmoothingQuality = "high";
	const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
	const w = image.width * scale, h = image.height * scale;
	ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
	for (let quality = 0.92; quality > 0.4; quality -= 0.06) {
		const url = canvas.toDataURL("image/webp", quality);
		if (url.length * 0.75 <= ${MAX_BYTES} || quality <= 0.46) return url;
	}
})()`;

async function renderOne(template, theme) {
	const profile = mkdtempSync(join(tmpdir(), "cozyclay-thumbs-"));
	const chrome = spawnOwned(chromePath, [
		"--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
		"--window-size=1440,900", "--no-first-run", "--no-default-browser-check", ...gpuFlags, "about:blank",
	], { stdio: "ignore" });
	try {
		const cdp = client(await connect());
		await cdp.send("Page.enable");
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem(${JSON.stringify(THEME_KEY)}, ${JSON.stringify(theme)}); } catch {}` });
		await cdp.send("Page.navigate", { url: template.url });
		if (template.create) {
			await cdp.waitFor("the start screen", `document.querySelector('[data-template-id="${template.id}"]')`);
			await cdp.evaluate(`document.querySelector('[data-template-id="${template.id}"]').click()`);
			await sleep(200);
			await cdp.evaluate("document.querySelector('.v2-start-project-form').requestSubmit()");
		}
		await cdp.waitFor("the studio", "window.__cozyclay?.charA && !document.querySelector('.v2-start-screen')");
		await sleep(3000); // character model, textures and shadows settle
		const dataUrl = await cdp.evaluate(encodeInPage(FRAMINGS[template.id] ?? null));
		const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
		const file = join(outDir, `${template.id}-${theme}.webp`);
		writeFileSync(file, bytes);
		console.log(`${file.slice(ROOT.length + 1)}  ${(bytes.length / 1024).toFixed(1)} KB`);
	} finally {
		await terminateOwned(chrome);
		rmSync(profile, { recursive: true, force: true });
	}
}

mkdirSync(outDir, { recursive: true });
for (const template of templates) {
	for (const theme of THEMES) await renderOne(template, theme);
}
