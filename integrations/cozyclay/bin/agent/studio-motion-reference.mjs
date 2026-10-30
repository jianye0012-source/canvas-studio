// The motion reference every first spec needs, motion.describe essentials and goals, appended to the Studio
// animation prompt so it rides the cached prompt prefix instead of costing model round trips (in 66 audited
// agent sessions 66 read essentials and 52 read goals by tool before their first compile). describe() is
// deterministic, so the block is byte-identical in every request and session and the cache keeps it.
// Lazy: the describe graph loads three, which the package-isolated start of bin/cozyclay.mjs does not have.
export const MOTION_REFERENCE_TOPICS = ["essentials", "goals"];

let reference;

/** The <motion-reference> block: one describe answer per line, in MOTION_REFERENCE_TOPICS order. */
export async function motionReference() {
	if (reference === undefined) {
		const { describe } = await import("../../src/motion3/describe.js");
		reference = `<motion-reference>\n${MOTION_REFERENCE_TOPICS.map(topic => JSON.stringify(describe(topic))).join("\n")}\n</motion-reference>`;
	}
	return reference;
}

/** The Studio animation-mode system prompt: the rules and procedure, then the motion reference. */
export async function studioSystemPrompt() {
	const { STUDIO_SYSTEM_PROMPT } = await import("./studio-prompt.mjs");
	return `${STUDIO_SYSTEM_PROMPT}\n\n${await motionReference()}`;
}
