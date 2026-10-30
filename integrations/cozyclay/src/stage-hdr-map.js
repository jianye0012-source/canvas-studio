// The stage's HDR environment maps as textures, decoded once per session and
// shared by every scene that names them. A built-in map is drawn on first use,
// synchronously, so a look that names one renders it in the same frame; a
// loaded file is read from the asset store and decoded off the render path,
// and the stage keeps its own sky light until it lands (or if it never does).
// stage-sky.jsx prefilters the texture with PMREMGenerator for the light and
// draws it as the background.
import { useEffect, useSyncExternalStore } from "react";
import * as THREE from "three";
import { isBuiltinHdrId, isHdrAssetId } from "./stage-hdr.js";
import { BUILTIN_HEIGHT, BUILTIN_WIDTH, builtinEnvironmentPixels } from "./stage-hdr-builtins.js";
import { analyzedMap, decodeEnvironment, halfMapFromFloats } from "./stage-hdr-image.js";
import { getAsset, openAssetDb } from "./scene-assets.js";

// Decoded files kept besides the built-ins; an older one is disposed (three
// uploads it again if a scene still draws it).
const KEPT_FILES = 3;
// A stored file that fails to load is tried again a few times (5 s apart), then left failed until a reload.
const RETRIES = 3;
const entries = new Map(), listeners = new Set(), failures = new Map();
const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

function textureOf({ width, height, data }) {
	const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
	texture.mapping = THREE.EquirectangularReflectionMapping;
	texture.colorSpace = THREE.LinearSRGBColorSpace;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.needsUpdate = true;
	return texture;
}

function store(id, map) {
	const entry = Object.freeze({ id, width: map.width, height: map.height, horizon: map.horizon, brightest: map.brightest, texture: textureOf(map) });
	entries.set(id, entry);
	const files = [...entries.values()].filter((row) => row.texture && isHdrAssetId(row.id));
	for (const stale of files.slice(0, Math.max(0, files.length - KEPT_FILES))) {
		entries.delete(stale.id);
		stale.texture.dispose();
	}
	return entry;
}

/** What the cache holds for an id: a ready map, a pending or failed load, or null. Draws a built-in on first ask. */
function snapshot(id) {
	if (!id) return null;
	if (!entries.has(id) && isBuiltinHdrId(id)) store(id, analyzedMap(halfMapFromFloats(BUILTIN_WIDTH, BUILTIN_HEIGHT, builtinEnvironmentPixels(id))));
	return entries.get(id) ?? null;
}

/** Start reading and decoding a stored file once. A failed load is forgotten after a while so a later ask retries. */
function request(id) {
	if (!isHdrAssetId(id) || entries.has(id)) return;
	const pending = Object.freeze({ id, pending: true });
	entries.set(id, pending);
	(async () => {
		const db = await openAssetDb();
		try {
			const record = await getAsset(db, id);
			if (!record) throw new Error("it is not in this browser's asset store");
			return await decodeEnvironment(record);
		} finally { db.close(); }
	})().then((map) => {
		if (entries.get(id) === pending) store(id, map);
	}, (error) => {
		console.warn(`[cozyclay] could not load HDR environment ${id}: ${error.message}`);
		if (entries.get(id) !== pending) return;
		const failed = Object.freeze({ id, failed: error.message }), count = (failures.get(id) ?? 0) + 1;
		entries.set(id, failed);
		failures.set(id, count);
		if (count < RETRIES) setTimeout(() => { if (entries.get(id) === failed) { entries.delete(id); notify(); } }, 5000);
	}).finally(notify);
}

/** Warm the cache with a map the importer already decoded. */
export function rememberHdrMap(id, map) {
	failures.delete(id);
	store(id, map);
	notify();
}

/** The ready map for an id ({ texture, horizon, brightest, width, height }), or null while it loads or when it cannot. */
export function readyHdrMap(id) {
	const entry = snapshot(id);
	return entry?.texture ? entry : null;
}

/** React: the ready map for `id`, loading it when needed; re-renders when it lands. */
export function useHdrMap(id) {
	const entry = useSyncExternalStore(subscribe, () => snapshot(id));
	useEffect(() => { request(id); }, [id, entry]);
	return entry?.texture ? entry : null;
}
