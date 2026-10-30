/**
 * Clone a cached mesh graph for one instance on the set.
 *
 * `Object3D.clone(true)` shares a SkinnedMesh's skeleton with the cache, so
 * a Mixamo-as-statue (or any skinned GLB) can bind to the wrong bones. Graphs
 * that actually contain a SkinnedMesh go through SkeletonUtils; everything
 * else keeps the cheap deep clone.
 *
 * Both clones share materials with the cache, so each instance gets its own
 * copies (marked `instanceOwned`, disposed with the instance): a per-object
 * write such as `object.opacity` must not leak into other copies.
 */
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

export function graphHasSkinnedMesh(root) {
	let found = false;
	root?.traverse?.((node) => {
		if (node?.isSkinnedMesh) found = true;
	});
	return found;
}

export function cloneMeshGraph(source) {
	if (!source) return source;
	const root = graphHasSkinnedMesh(source) ? cloneSkeleton(source) : source.clone(true);
	const copies = new Map();
	const own = (material) => {
		if (!copies.has(material)) copies.set(material, material.clone());
		return copies.get(material);
	};
	root.traverse((node) => {
		if (!node.isMesh || !node.material) return;
		node.material = Array.isArray(node.material) ? node.material.map(own) : own(node.material);
		node.userData.instanceOwned = true;
	});
	return root;
}
