// The asset summary the agent's turn context lists: every catalogue kind the
// Studio can create, then each imported picture or model once.
import { CUTOUT_KIND, MESH_KIND, OBJECT_MENU_ENTRIES } from "./scene-objects.js";
import { studioObjectCatalogue } from "./studio-agent-commands.js";

export function studioAssetList(objects) {
	const catalogue = studioObjectCatalogue().objects.map(({ kind }) => {
		const entry = OBJECT_MENU_ENTRIES.find(row => row.kind === kind);
		return { kind, name: entry?.label ?? kind, type: entry?.group === "Primitives" ? "primitive" : "set-piece" };
	});
	const imported = new Map();
	for (const o of objects) {
		const assetId = o.renderer === CUTOUT_KIND ? o.sourceAssetId || o.assetId : o.renderer === MESH_KIND ? o.assetId : null;
		if (assetId && !imported.has(assetId)) imported.set(assetId, { id: assetId, name: o.name || assetId, type: o.renderer === CUTOUT_KIND ? "image" : "mesh" });
	}
	return [...catalogue, ...imported.values()];
}
