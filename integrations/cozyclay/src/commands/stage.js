import { elementSetSchema, registerElementSet } from './elements.js';
import { normalizeStage } from './elements/stage.js';
import { applyLightingRecipe, LIGHTING_KEEP_PATHS, LIGHTING_PRESETS } from '../stage-lighting.js';
export { STAGE_FIELDS, normalizeStage } from './elements/stage.js';

const input = elementSetSchema('stage');
const declaration = (id, properties = input.properties) => ({ id, label: 'Set stage', kind: 'mutation', undoDomain: 'stage',
  description: 'Update authored stage fields, normalized by scene persistence.',
  input: { ...input, properties } });
const applyLighting = { id: 'stage.applyLighting', label: 'Apply lighting', kind: 'mutation', undoDomain: 'stage',
  description: 'Give the stage a whole lighting look in one undoable step: writes every stage.lighting field (sky, skyTop, ambient, hemiSky, hemiGround, fill, fog, exposure, shadowSoftness, envLight, ao) and the key light\'s colour, intensity and position from the recipe, then sets lighting.preset to its name. studio is the neutral grey default; day is a high sun under a blue sky; overcast is soft, shadowless grey daylight; golden a low warm sun with long shadows; dusk a dim warm horizon glow under a blue sky; night a dark blue-black sky, a dim cool moon key with soft shadows, low cool ambient and haze; interior a warm tungsten lamp in a dark room; stage a black void lit by the key alone. Every recipe but studio lights the set with a sky environment map (envLight 1) and darkens contacts and creases (ao 0.6 to 1); studio keeps both at 0. keep lists paths left as they are, e.g. ["keyLight.position"] to keep where the light stands; a recipe also clears an HDR environment (stage.lighting.hdr) unless keep has "lighting.hdr". Tweak any value afterwards with stage.set; check the result with verify_result checks ["lighting"].',
  input: { type: 'object', properties: { preset: { type: 'string', enum: [...LIGHTING_PRESETS] },
    keep: { type: 'array', items: { type: 'string', enum: [...LIGHTING_KEEP_PATHS] }, minItems: 1, maxItems: LIGHTING_KEEP_PATHS.length, uniqueItems: true } }, required: ['preset'], additionalProperties: false } };
export const declarations = Object.freeze([
  declaration('stage.set'),
  declaration('stage.setKeyLight', { keyLight: input.properties.keyLight }),
  declaration('stage.setEnvironment', Object.fromEntries(['environment', 'environmentImage', 'hasEnvSheet'].map(key => [key, input.properties[key]]))),
  declaration('stage.setStyle', { style: input.properties.style }),
  declaration('stage.setFilmback', Object.fromEntries(['shotAspect', 'cameraPresetId', 'sensorId'].filter(key => input.properties[key]).map(key => [key, input.properties[key]]))),
  applyLighting,
]);
export function register(registry, ports) {
  for (const declaration of declarations.filter(entry => entry !== applyLighting)) registerElementSet(registry, ports, declaration);
  registry.register({ ...applyLighting, available: () => true, run({ preset, keep = [] }) {
    const domain = ports.storeDomain('stage'), before = domain.read();
    const next = normalizeStage({ ...before, ...applyLightingRecipe(before, preset, keep) });
    if (JSON.stringify(next) !== JSON.stringify(before)) domain.write(next);
    return { affectedIds: [ports.state().activeSceneId], summary: `Applied the ${preset} lighting recipe${keep.length ? `, keeping ${keep.join(', ')}` : ''}.` };
  } });
}
