import { normalizeSceneObject, updateSceneObject } from '../../scene-objects.js';
import { STUDIO_ELEMENTS } from '../../studio-elements.js';
import { registerElementKind } from '../elements.js';

const components = {
  position: { x: 'x', y: 'y', z: 'z' },
  rotation: { x: 'rotX', y: 'rot', z: 'rotZ' },
  scale: { x: 'scaleX', y: 'scaleY', z: 'scaleZ' },
};
const elements = STUDIO_ELEMENTS.filter(row => row.path.startsWith('object.')).map(row => {
  // Wire validation checks finite numbers; persistence owns the transform clamps.
  const { min, max, ...element } = row;
  const field = row.path.slice(7);
  return { ...element, ...(components[field] ? { documentPath: components[field] } : {}),
    ...(field === 'remove' ? { readback: item => ({ flag: item === undefined }) } : {}) };
});
function normalizeObjectSet(record) {
  const item = normalizeSceneObject(record);
  // The owning collection consumes this lifecycle intent before persistence.
  return record.remove === true ? { ...item, remove: true } : item;
}
// A set that moves or turns a record carries its descendants exactly as object.update, the
// inspector and the gizmo do (updateSceneObject): rigidly about the record's pivot, scale not carried.
const TRANSFORM = ['x', 'y', 'z', 'rotX', 'rot', 'rotZ'];
const carryDescendants = (rows, id, after) => after ? updateSceneObject(rows, id, Object.fromEntries(TRANSFORM.map(key => [key, after[key]]))) : rows;
registerElementKind('object', { collection: true, documentKey: 'objects', elements, normalize: normalizeObjectSet, carry: carryDescendants });
