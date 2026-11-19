import { openAssetDb, referencedAssetIds, putAsset } from "./scene-assets.js";
import { verifyEmbeddedAsset } from "./project.js";

export async function rehydrateProjectAssets(project, warnings = []) {
	for (const warning of warnings) console.warn(`[cozyclay] ${warning}`);
	if (!project.assets.length) return;
	try {
		const db = await openAssetDb();
		try {
			const referenced = referencedAssetIds(project.scenesDocument.scenes);
			const results = await Promise.allSettled(project.assets.map(async (asset) => {
				if (!referenced.has(asset.id)) {
					console.warn(`[cozyclay] skipped embedded asset outside the project closure: ${asset.id}`);
					return;
				}
				if (!(await verifyEmbeddedAsset(asset))) {
					console.warn(`[cozyclay] skipped embedded asset with mismatched content address: ${asset.id}`);
					return;
				}
				await putAsset(db, asset);
			}));
			for (const result of results) if (result.status === "rejected") console.warn("[cozyclay] could not restore an embedded asset", result.reason);
		} finally {
			db.close();
		}
	} catch (error) {
		console.warn("[cozyclay] could not open the asset store for project restore", error);
	}
}
