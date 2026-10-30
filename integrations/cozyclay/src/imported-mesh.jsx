/**
 * An imported model: the cached GLB cloned per instance, fitted to the
 * record's stored height and stood on y = 0. A grey box stands in while the
 * file loads (or if it is gone).
 */
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { subscribeToMeshScene } from "./scene-mesh-cache.js";
import { cloneMeshGraph } from "./mesh-graph-clone.js";

/** The placeholder tint for a model that has not arrived: blockout grey. */
const MISSING_MESH = "#c2c6c8";

/** The parsed GLB for an `assetId`, or null while it loads (or forever, if
 * the blob is gone). The cached graph is the FILE's own pivot and materials;
 * each instance clones, then fits to the stored height. */
function useMeshScene(assetId) {
	const [scene, setScene] = useState(null);
	useEffect(() => {
		setScene(null);
		if (!assetId) return undefined;
		return subscribeToMeshScene(assetId, setScene);
	}, [assetId]);
	return scene;
}

function disposeOwnedMaterials(root) {
	if (!root) return;
	root.traverse((node) => {
		if (!node.isMesh || !(node.userData?.clayOwned || node.userData?.instanceOwned)) return;
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		for (const material of materials) material?.dispose?.();
	});
}

/**
 * Clone the cached graph, scale so its bbox height equals the stored
 * `object.height`, and sit the underside on y = 0. The import heuristic
 * already wrote that height — this pass must not re-guess it.
 *
 * Skinned graphs go through `cloneMeshGraph` so a Mixamo-as-statue keeps
 * its bind pose. Clay replaces materials on THIS clone only, so a second
 * instance of the same file can keep the textures from the disk. Every clone
 * owns its materials, so auto-color tints and opacity fades never leak.
 */
function instantiateMesh(source, object) {
	const root = cloneMeshGraph(source);
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	const size = box.getSize(new THREE.Vector3());
	const targetHeight = Number(object.height);
	if (Number.isFinite(targetHeight) && targetHeight > 0 && size.y > 1e-8) {
		root.scale.multiplyScalar(targetHeight / size.y);
		root.updateMatrixWorld(true);
		box.setFromObject(root);
	}
	if (Number.isFinite(box.min.y)) root.position.y -= box.min.y;
	const clay = object.clay === true;
	const clayColor = object.autoColor ?? object.color ?? "#c4b8a8";
	root.traverse((node) => {
		if (node.isLight || node.isCamera) {
			node.visible = false;
			return;
		}
		if (!node.isMesh) return;
		node.castShadow = true;
		node.receiveShadow = true;
		if (clay) {
			const make = () => new THREE.MeshStandardMaterial({ color: clayColor, roughness: 0.9, metalness: 0 });
			for (const material of Array.isArray(node.material) ? node.material : [node.material]) material?.dispose?.();
			node.material = Array.isArray(node.material) ? node.material.map(() => make()) : make();
			node.userData.clayOwned = true;
			return;
		}
		if (!object.autoColor || !node.material) return;
		// cloneMeshGraph already gave this instance its own materials.
		for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
			if (material.color) material.color.set(object.autoColor);
		}
	});
	return root;
}

export function ImportedMesh({ object }) {
	const source = useMeshScene(object.assetId);
	const root = useMemo(
		() => (source ? instantiateMesh(source, object) : null),
		[source, object.height, object.clay, object.autoColor, object.color],
	);
	useEffect(() => () => disposeOwnedMaterials(root), [root]);
	if (!root) {
		const width = object.footprint?.width ?? 1;
		const depth = object.footprint?.depth ?? 1;
		const height = object.height ?? 1;
		return (
			<mesh position={[0, height / 2, 0]} castShadow receiveShadow>
				<boxGeometry args={[width, height, depth]} />
				<meshStandardMaterial color={MISSING_MESH} roughness={0.92} metalness={0} />
			</mesh>
		);
	}
	return <primitive object={root} />;
}
