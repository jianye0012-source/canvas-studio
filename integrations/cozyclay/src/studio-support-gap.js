// How far each placed object stands off what holds it up: the support gap verify_result's
// placement check reports beside the footprint overlap (studio-agent-commands.js placementChecks),
// measured on the same world AABB proxies.
//
// A group is one unit: the union AABB of its solid parts, judged through its root (a part names
// its root group). Its support is the floor, or the highest top among the other solid objects
// whose footprint overlaps the unit's and whose top lies below the unit's middle height.
// supportGapM is the unit's bottom above that top (0 when it rests on it or sinks into it).
// These are measurements, not failures: unsupportedIds lists the gaps over 1 cm.
//
// Not measured: characters, lights, effects, a group with no solid part, records on a route or
// riding a character, and records an installed take moves where their scene pose is never drawn
// (a follow or hinge entry, or a carry in hand from its first frame). A carry grabbed later
// stands at its scene pose until the grab, so it is measured there.
import { descendantsOf, isEffectivelyHidden, isEmptyObject } from './scene-objects.js';
import { EFFECT_KIND } from './effects/effect-record.js';
import { isCarried, movesRecord } from './motion3/carried.js';

const UNSUPPORTED_M = 0.01, EPS = 1e-6;
const round = v => Number(v.toFixed(4));

/** Ids the installed takes move (spec.objects keys of each target's take v3), from the binding's targets map. */
function takeMovedIds(takes) {
  const moved = new Set();
  for (const target of takes?.values?.() ?? []) {
    const take = target?.motion;
    if (take?.schema !== 'cozyclay.take.v3') continue;
    for (const [id, entry] of Object.entries(take.spec?.objects ?? {}))
      if (movesRecord(entry) && !(isCarried(entry) && entry.grab > 0)) moved.add(id);
  }
  return moved;
}

/** [object, parent, ..., root] by id, stopping at a missing parent or a loop. */
function chainOf(id, byId) {
  const chain = [];
  for (let o = byId.get(id); o && !chain.includes(o); o = o.parent ? byId.get(o.parent) : null) chain.push(o);
  return chain;
}

const solid = (o, state) => !isEmptyObject(o) && o.renderer !== EFFECT_KIND && !isEffectivelyHidden(o, state.objects, state.characters);

/** Union { min, max } of boxes, or null for none. */
function union(boxes) {
  if (!boxes.length) return null;
  const pick = (end, f) => Object.fromEntries(['x', 'y', 'z'].map(a => [a, f(...boxes.map(b => b[end][a]))]));
  return { min: pick('min', Math.min), max: pick('max', Math.max) };
}

const footprintsOverlap = (a, b) => ['x', 'z'].every(a2 => Math.min(a.max[a2], b.max[a2]) - Math.max(a.min[a2], b.min[a2]) > EPS);

/**
 * { supportGapM: { unitId: metres }, unsupportedIds } for the objects among `ids` (each unit once).
 * boxOf(entity) answers its world { min, max } or null (studio-agent-commands.js entityWorldBounds);
 * takes is the binding's targets map (characterId -> { motion }), or undefined.
 */
export function supportGaps(ids, state, takes, boxOf) {
  const byId = new Map(state.objects.map(o => [o.id, o])), moved = takeMovedIds(takes);
  const rootOf = id => chainOf(id, byId).at(-1)?.id;
  // A part counts when nothing above it rides a character, a route or a take.
  const free = o => chainOf(o.id, byId).every(c => !c.attach && !c.path && !moved.has(c.id));
  const units = [...new Set(ids.filter(id => byId.has(id)).map(rootOf))];
  const boxes = new Map(state.objects.filter(o => solid(o, state)).map(o => [o.id, boxOf(o)]).filter(([, box]) => box));
  const supportGapM = {};
  for (const root of units) {
    const parts = [byId.get(root), ...descendantsOf(state.objects, root)].filter(o => boxes.has(o.id) && free(o));
    const own = union(parts.map(o => boxes.get(o.id)));
    if (!own) continue;
    const middle = (own.min.y + own.max.y) / 2;
    const tops = [...boxes].filter(([id, box]) => rootOf(id) !== root && box.max.y <= middle && footprintsOverlap(own, box)).map(([, box]) => box.max.y);
    supportGapM[root] = round(Math.max(0, own.min.y - Math.max(state.floorY ?? 0, ...tops)));
  }
  return { supportGapM, unsupportedIds: Object.keys(supportGapM).filter(id => supportGapM[id] > UNSUPPORTED_M) };
}
