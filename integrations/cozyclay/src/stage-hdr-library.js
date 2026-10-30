// The HDR environments the stage can use: the built-ins and every environment
// file loaded into this browser's asset store. The Light panel lists them and
// inspect_studio { scope: "catalogue" } answers them as `environments`, so the
// agent, which cannot upload a file, can pick a map the user already loaded and
// aim it. Loading a file goes through here too: checked, decoded once, stored
// under its content address and remembered decoded.
import { declaredHdrSize, HDR_BUILTINS, HDR_MAX_BYTES, hdrFileProblem, hdrIdForBytes, isHdrAssetId, sniffHdrType } from "./stage-hdr.js";
import { getAsset, listAssetIds, openAssetDb, putAsset } from "./scene-assets.js";
import { decodeEnvironment } from "./stage-hdr-image.js";
import { rememberHdrMap } from "./stage-hdr-map.js";

const listeners = new Set();
const builtins = HDR_BUILTINS.map(({ id, name, brightest, note }) => ({ id, name, source: "builtin", brightest, note }));
let files = [], catalogue = Object.freeze([...builtins]);

function publish(next) {
	files = next;
	catalogue = Object.freeze([...builtins, ...files.map(({ id, name, width, height, megabytes, brightest }) => ({
		id, name, source: "file", ...(width ? { size: `${width}x${height}` } : {}), megabytes, ...(brightest ? { brightest } : {}),
	}))]);
	for (const listener of listeners) listener();
}

/** Every environment, built-ins first: { id, name, source: "builtin" | "file", brightest?, note?, size?, megabytes? }. */
export const hdrEnvironmentCatalogue = () => catalogue;
export function subscribeHdrLibrary(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Re-read the stored environment files' names and sizes. Without IndexedDB the list is the built-ins. */
export async function refreshHdrLibrary() {
	let db = null;
	try {
		db = await openAssetDb();
		const ids = (await listAssetIds(db)).filter(isHdrAssetId);
		const records = (await Promise.all(ids.map((id) => getAsset(db, id)))).filter(Boolean);
		publish(records.map(({ id, name, width, height, brightest, bytes }) => ({ id, name: name || id, width, height, brightest, megabytes: Number((bytes.byteLength / 1048576).toFixed(2)) }))
			.sort((a, b) => a.name.localeCompare(b.name)));
	} catch {
		publish([]);
	} finally {
		db?.close?.();
	}
}

/**
 * Load one environment file the user picked: at most HDR_MAX_BYTES (32 MB) and
 * HDR_MAX_PIXELS, decoded before it is stored so a broken file never reaches
 * the store. Answers { id, name }; throws with a sentence for the user.
 */
export async function importHdrFile(file) {
	const early = file.size > HDR_MAX_BYTES ? hdrFileProblem(file.size, null, null) : null;
	if (early) throw new Error(early);
	const buffer = await file.arrayBuffer(), bytes = new Uint8Array(buffer), type = sniffHdrType(bytes), size = declaredHdrSize(type, bytes);
	const problem = hdrFileProblem(bytes.length, type, size);
	if (problem) throw new Error(problem);
	let map;
	try { map = await decodeEnvironment({ type, bytes: buffer }); }
	catch (error) { throw new Error(`that file could not be decoded (${error.message})`, { cause: error }); }
	const id = await hdrIdForBytes(bytes), db = await openAssetDb();
	try {
		await putAsset(db, { id, type, bytes: buffer, name: file.name || id, ...(size ?? { width: map.width, height: map.height }), brightest: map.brightest });
	} finally {
		db.close();
	}
	rememberHdrMap(id, map);
	await refreshHdrLibrary();
	return { id, name: file.name || id };
}
