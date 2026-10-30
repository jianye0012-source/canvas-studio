// object.createKit: a ready-made prop (src/kits/) built as one group, an Empty root at the grip
// plus its parts, written as one undo entry. It is a job so the answer carries its output:
// { rootId, parts: { role: id }, bind, props?, skill? }. bind is the spec.objects snippet a take
// pastes: the root's carry (at/along pin it to the prop origin) and the switch entries of the
// parts that light up (docs/motion-api-v3.1.md C15).
import { buildKit, KIT_NAMES } from "../kits/index.js";
import { fail } from "./shared.js";

const KIT_HELP = `Create a ready-made, correctly scaled prop as one group (an Empty root at the grip plus its parts), one undo entry. kit: ${KIT_NAMES.join(", ")} (inspect_studio scope catalogue lists each with its parts). `
	+ "position { x, y, z, rot? } places the root (world m, yaw degrees; default the origin, lifted so nothing is under the floor); name names the root. "
	+ "Answers rootId, parts { role: id } and bind: the spec.objects snippet to paste into a motion spec (the root's carry: prop, at, along, plus switch entries { visible, level } that show the lit parts). "
	+ "Kits without a skill also answer props (the grip prop to paste into spec.props). The cigarette, lighter and exhale need no paste: smokeCigarette args.kit { cig, lighter, exhale? } adds the entries itself "
	+ "(exhale: a puff that follows the mouth, no placing). "
	+ "Example: { kit: \"cigarette\" } -> { rootId: \"empty-3\", parts: { body: \"sculpt-2\", ember: \"sphere\", light: \"point-light\", smoke: \"effect\" }, bind: { \"empty-3\": { prop: \"cig\", at: [0, 0, 0], along: [0, 0, 1], visible: \"cig_vis\" }, "
	+ "sphere: { visible: \"ember_vis\", level: \"ember\" }, \"point-light\": { visible: \"ember_vis\", level: \"ember\" }, effect: { visible: \"ember_vis\" } } }; "
	+ "then motion.compile use [{ skill: \"smokeCigarette\", f0: 0, args: { kit: { cig: \"empty-3\", lighter: \"<lighter rootId>\" } } }].";

const number = { type: "number" };
const input = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });

export const declarations = Object.freeze([
	{ id: "object.createKit", label: "Create a prop kit", kind: "job", domain: "objects", description: KIT_HELP,
		input: input({ kit: { type: "string", enum: KIT_NAMES }, name: { type: "string", minLength: 1, maxLength: 120 }, position: input({ x: number, y: number, z: number, rot: number }, []) }, ["kit"]) },
]);

export function register(registry, ports) {
	const owned = () => ports.storeDomain("objects");
	const available = () => Boolean(ports.storeDomain?.("objects")) || "The objects document owner is not mounted.";
	registry.register({ ...declarations[0], available, run({ kit, name, position }, context) {
		const before = owned().read(), built = buildKit(kit, before, { name, position });
		if (built.error) fail("INVALID_ARGUMENT", built.error);
		const write = () => owned().write([...before, ...built.records]);
		if (context?.commit) context.commit(write); else write();
		const { records, ...output } = built, ids = records.map(row => row.id);
		return { affectedIds: ids, output, summary: `Created the ${kit} kit ${built.rootId} (${Object.entries(built.parts).map(([role, id]) => `${role} ${id}`).join(", ")}).` };
	} });
}
