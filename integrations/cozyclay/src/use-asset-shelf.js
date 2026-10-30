import { useEffect, useMemo, useRef, useState } from "react";
import { ASSET_DELETE_UNDO_MS } from "./app-stage.jsx";
import { CUTOUT_KIND, MESH_KIND } from "./scene-objects.js";
import { assetGraphSignature } from "./scene-assets.js";

export function useAssetShelf({ scenes, activeSceneId, sceneObjects }) {
	// The imported-pictures region of the Assets shelf. null = the scan has
	// never resolved (the pane shows skeletons, NEVER the empty message); an
	// array = the SOURCE ids to show, mattes and cut renders already filtered
	// out (asset-shelf.js). Scans run only while the shelf is visible, and
	// re-run when a cutout's lineage changes — not on every transform tick, so
	// a gizmo drag never hammers IndexedDB.
	const [shelfImageIds, setShelfImageIds] = useState(null);
	const [shelfMeshIds, setShelfMeshIds] = useState(null);
	const [manageAssetStorage, setManageAssetStorage] = useState(false);
	// A separate scan preserves the source-only placement shelf while the
	// manager exposes every unreachable stored record, including matte and cut
	// derivatives orphaned with a deleted card.
	const [unusedAssetIds, setUnusedAssetIds] = useState(null);
	const [usedAssetIds, setUsedAssetIds] = useState(null);
	const [usageCounts, setUsageCounts] = useState(new Map());
	const assetShelfScanTokenRef = useRef(0);
	const legacyDerivedIdsRef = useRef(new Set());
	// This is deliberately session-only. Each entry is a complete IndexedDB
	// record, so Undo can put it back byte-for-byte until the page is reloaded.
	const [assetTrash, setAssetTrash] = useState([]);
	// Same rule as the object deletion offer: the toast is a window, not a
	// banner. Only the OFFER expires — the trashed record itself is the restore
	// data, so it is deliberately kept for the session and never timed out.
	const [assetUndoOffered, setAssetUndoOffered] = useState(false);
	useEffect(() => {
		if (!assetUndoOffered) return undefined;
		const timer = setTimeout(() => setAssetUndoOffered(false), ASSET_DELETE_UNDO_MS);
		return () => clearTimeout(timer);
	}, [assetUndoOffered]);
	const [deletingAssetId, setDeletingAssetId] = useState(null);
	const cutoutLineage = useMemo(
		() => JSON.stringify(sceneObjects.flatMap((object) => (object.renderer === CUTOUT_KIND ? [[object.assetId, object.sourceAssetId, object.matteAssetId]] : []))),
		[sceneObjects],
	);
	const meshLineage = useMemo(
		() => JSON.stringify(sceneObjects.flatMap((object) => (object.renderer === MESH_KIND ? [object.assetId] : []))),
		[sceneObjects],
	);
	const projectCutoutLineage = useMemo(() => {
		const allScenes = scenes.map((scene) => (scene.id === activeSceneId ? { ...scene, objects: sceneObjects } : scene));
		return JSON.stringify(
			allScenes.flatMap((scene) =>
				(Array.isArray(scene.objects) ? scene.objects : []).flatMap((object) =>
					object.renderer === CUTOUT_KIND ? [[object.assetId, object.sourceAssetId, object.matteAssetId]] : [],
				),
			),
		);
	}, [scenes, activeSceneId, sceneObjects]);
	const projectAssetGraphSignature = useMemo(() => {
		const allScenes = scenes.map((scene) => (scene.id === activeSceneId ? { ...scene, objects: sceneObjects } : scene));
		return assetGraphSignature(allScenes);
	}, [scenes, activeSceneId, sceneObjects]);
	return { shelfImageIds, setShelfImageIds, shelfMeshIds, setShelfMeshIds, manageAssetStorage, setManageAssetStorage, unusedAssetIds, setUnusedAssetIds, usedAssetIds, setUsedAssetIds, usageCounts, setUsageCounts, assetShelfScanTokenRef, legacyDerivedIdsRef, assetTrash, setAssetTrash, assetUndoOffered, setAssetUndoOffered, deletingAssetId, setDeletingAssetId, cutoutLineage, meshLineage, projectCutoutLineage, projectAssetGraphSignature };
}
