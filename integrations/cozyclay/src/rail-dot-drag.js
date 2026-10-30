// A free drag on a camera rail's dot in the 3D view (CraneHandles): the dot moves over the floor and the rail
// bends under it, with the weighted bump the X and Z arrows use (prepareRailBend), on both floor axes at once.
// The drag reads the floor plane, not a plane level with the dot: that one goes edge-on when the editor's eye
// is at crane height. The dot's height stays on the Y arrow.
import * as THREE from "three";
import { prepareRailBend, railPoint } from "./camera-follow.js";

const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * The drag a free press on crane mark `index` starts, shaped like an arrow drag (axis "floor"), or null when it
 * cannot bend the rail: Shift (a slide along the arc), no rail callback or control points, or a ray off the floor.
 * s: CraneHandles' live state { rail, crane, controlPoints, onChangeRail }; ray: the press's ray.
 */
export function floorDragStart(s, index, ray, shiftKey) {
	const point = s.crane?.points[index];
	if (shiftKey || !point || !s.rail || !s.onChangeRail) return null;
	const bend = prepareRailBend(s.controlPoints, railPoint(s.rail, point.t * s.rail.length), s.crane.points, index);
	const hitStart = new THREE.Vector3();
	if (!bend || !ray.intersectPlane(FLOOR, hitStart)) return null;
	return { axis: "floor", index, dir: new THREE.Vector3(), plane: FLOOR, hitStart, startControls: bend.startControls, bendWeights: bend.weights,
		t0: bend.t0, radius: bend.radius, recorded: false };
}
