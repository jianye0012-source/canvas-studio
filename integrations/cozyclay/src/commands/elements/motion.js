import { registerElementKind } from '../elements.js';
import { readTake } from './take-read.js';

const elements = [
  { path: 'motion.take.prompt', type: 'string' },
  { path: 'motion.ikKeys', type: 'array', readOnly: true },
  { path: 'motion.takeRecipe', type: 'object', readOnly: true },
  { path: 'motion.takeVersions', type: 'array', readOnly: true },
];
// The full take is the take itself until an edit splits them: a read answers its source once.
const readMotion = (rows, named) => rows.map(row => {
  const same = Boolean(row.fullTake?.resourceId) && row.fullTake.resourceId === row.take?.resourceId;
  return { ...row, take: readTake(row.take, named(row.id)), fullTake: readTake(row.fullTake, !same && named(row.id)) };
});
registerElementKind('motion', { collection: true, elements, read: readMotion, normalize: row => ({ ...row, take: row.take && { ...row.take } }) });
