import { cameraKeyWarnings } from '../../camera-direction.js';
import { createShotAuthoringDocument } from '../../shot-authoring.js';
import { STUDIO_ELEMENTS } from '../../studio-elements.js';
import { registerElementKind } from '../elements.js';

function normalizeShot(record) {
  return createShotAuthoringDocument({ shots: [record], frameCount: Math.max(24, record.endFrame + 1) }).shots[0];
}
// A shot.set that writes camera keys hears when they halt the move, like frame_shot does.
registerElementKind('shot', { collection: true, documentKey: 'shots',
  elements: STUDIO_ELEMENTS.filter(row => row.path.startsWith('shot.')), normalize: normalizeShot,
  warn: (shot, set) => (Object.hasOwn(set, 'cameraKeys') ? cameraKeyWarnings(shot) : []) });
