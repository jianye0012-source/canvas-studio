// A finger pressing a button in an empty scene, placed so the left arm is at full reach: the
// body has to come closer. The body stands where a standIdle puts it ("stand"), where a walkTo
// ends ("walk"), or where the agent's own root keys hold it after the walk ("root"). The goal
// names anchor:button, so the button is a pinned point (REACH moves the body too).
const BASE = { schema: "cozyclay.motion-spec.v1", fps: 24,
	props: { tip: { hand: "l", origin: ["LeftHandIndex2", "LeftHandMiddle2"], points: { finger: [0, 0, 0] } } },
	fits: [{ side: "l", anchor: "button", effector: { prop: "tip", point: "finger" } }] };

/** press(how, z): the button at [0.2, 1.25, z]; the goal holds over the press. */
export function press(how, z) {
	const walk = how !== "stand", f = walk ? 80 : 10, frames = walk ? 120 : 60;
	const spec = { ...structuredClone(BASE), frames, anchors: { button: { kind: "world", p: [0.2, 1.25, z] } },
		use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } }, ...(walk ? [{ skill: "walkTo", f0: 2, args: { steps: 2, firstStep: 0.3, heading: 0 } }] : [])],
		keys: [{ f, set: { armw_l: 0, w_button_l: 0 } }, { f: f + 20, set: { armw_l: 1, w_button_l: 1 } }, { f: frames - 1, set: { w_button_l: 1 } }],
		goals: [{ name: "finger on the button", near: ["prop:tip.finger", "anchor:button"], tol: 0.02, at: [f + 22, f + 30] }] };
	if (how === "root") spec.keys.push({ f: 82, set: { root: [0, 0.97, 0.37] } }, { f: 115, set: { root: [0, 0.97, 0.37] } });
	return spec;
}
