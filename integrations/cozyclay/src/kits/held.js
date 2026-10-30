// Hand-held kits with no skill of their own: a baseball bat, a ball, a sword and a pistol. Each
// answers the prop its root rides (props) besides the spec.objects carry entry, so the agent
// pastes both. Positions are in the kit root's frame (metres, each part record's base pivot).
// A fist holds a bar across the palm: the bar runs along the palm's l axis (toward the thumb side)
// and sits on the palm side of the finger middles, which is -n for the right hand.

const RIGHT_FINGERS = ["RightHandIndex2", "RightHandMiddle2"];
/** The bar's centre in a right fist, from the finger middles (d, l, n), m. */
const FIST = [0, 0, -0.015];
const along = (k, from = FIST) => [from[0], +(from[1] + k).toFixed(4), from[2]];

// A baseball bat along +Y from the knob (y 0) to the end cap (y 0.84): radius by height (m), a
// smooth taper from the 27 mm handle to the 67 mm barrel drawn as short frustums.
const BAT_PROFILE = [[0.012, 0.0122], [0.3, 0.0135], [0.36, 0.016], [0.41, 0.0195], [0.46, 0.024], [0.51, 0.0285], [0.56, 0.0318], [0.61, 0.0332], [0.825, 0.0335]];
const WOOD = "#c99b5e";
const batParts = () => [
	{ id: "knob", shape: "blob", size: [0.052, 0.018, 0.052], position: [0, 0.009, 0], roundness: 0, color: "#a8784a" },
	...BAT_PROFILE.slice(1).map(([y, r], i) => {
		const [y0, r0] = BAT_PROFILE[i];
		return { id: `seg-${i}`, shape: "cylinder", size: [2 * r, +(y - y0).toFixed(4), 2 * r], position: [0, +((y + y0) / 2).toFixed(4), 0], taper: +(-(1 - r0 / r)).toFixed(4), color: WOOD };
	}),
	{ id: "cap", shape: "blob", size: [0.067, 0.03, 0.067], position: [0, 0.825, 0], roundness: 0, color: WOOD },
];
// The batting grip of the baseball swing fixture (test/motion3/fixtures/bat-swing.mjs): the bat
// runs along u in the palm frame, the right hand 14 cm above the knob, the left hand's point `low`.
const BAT_AXIS = [0, 0.5, 0.866], onBat = k => BAT_AXIS.map(c => +(c * k).toFixed(4));

export const bat = {
	label: "Baseball bat", prop: "batGrip",
	description: "0.84 m wooden baseball bat (knob, handle, taper, barrel, end cap) held in the right hand 14 cm above the knob, with a motion-trail effect on the barrel",
	props: { batGrip: { hand: "r", origin: RIGHT_FINGERS, points: { low: onBat(-0.085), knob: onBat(-0.14), tip: onBat(0.7) } } },
	carry: { prop: "batGrip", at: onBat(-0.14), along: BAT_AXIS },
	parts: [
		{ role: "body", kind: "sculpt", at: [0, 0, 0], recipe: { version: 1, parts: batParts() } },
		{ role: "trail", kind: "effect", at: [0, 0.69, 0], effect: { preset: "trail", width: 0.3 } },
	],
};

export const ball = {
	label: "Baseball", prop: "ballGrip",
	description: "7.4 cm baseball held in the right palm and fingers",
	props: { ballGrip: { hand: "r", origin: RIGHT_FINGERS, points: { centre: [0, 0, -0.035] } } },
	// no pinned point: it rests against the palm where the hand takes it and the fingers close round it (motion3 seat.js)
	carry: { prop: "ballGrip", grasp: "spherical" },
	parts: [{ role: "body", kind: "sphere", at: [0, -0.037, 0], scale: [0.074, 0.074, 0.074], color: "#f1ede3" }],
};

const STEEL = "#c9ced3", BRASS = "#a8874f";
export const sword = {
	label: "Sword", prop: "swordGrip",
	description: "1 m one-handed sword (pommel, grip, guard, blade) held in the right fist at the grip, with a motion-trail effect on the blade",
	props: { swordGrip: { hand: "r", origin: RIGHT_FINGERS, points: { tip: along(0.87) } } },
	carry: { prop: "swordGrip", at: FIST, along: [0, 1, 0] },
	parts: [
		{ role: "body", kind: "sculpt", at: [0, -0.125, 0], recipe: { version: 1, parts: [
			{ id: "pommel", shape: "blob", size: [0.042, 0.035, 0.042], position: [0, 0.0175, 0], roundness: 0.2, color: BRASS },
			{ id: "grip", shape: "cylinder", size: [0.028, 0.17, 0.024], position: [0, 0.12, 0], color: "#4a3326" },
			{ id: "guard", shape: "box", size: [0.2, 0.024, 0.032], position: [0, 0.217, 0], roundness: 0.3, color: BRASS },
			{ id: "blade", shape: "box", size: [0.044, 0.68, 0.0065], position: [0, 0.569, 0], roundness: 0.1, color: STEEL },
			{ id: "tip", shape: "cylinder", size: [0.044, 0.09, 0.0065], position: [0, 0.954, 0], taper: 1, color: STEEL }] } },
		{ role: "trail", kind: "effect", at: [0, 0.5, 0], effect: { preset: "trail", width: 0.6 } },
	],
};

// The barrel points along the palm's d axis (forward out of the fist), the grip runs along l.
// The flash and its light are showOnlyInTake: hidden in a static scene, shown only on frames a take's muzzle_vis is on.
const MUZZLE = [0.155, 0.08, 0];
export const pistol = {
	label: "Pistol", prop: "gunGrip",
	description: "19 cm pistol held in the right fist, with a muzzle-flash glow and light at the muzzle that show only on frames its muzzle_vis channel is above 0.5",
	props: { gunGrip: { hand: "r", origin: ["RightHand", "RightHandMiddle1"], points: { muzzle: MUZZLE } } },
	carry: { prop: "gunGrip", at: [0, 0, 0], along: [0, 1, 0] },
	parts: [
		{ role: "body", kind: "sculpt", at: [0, -0.065, 0], recipe: { version: 1, parts: [
			{ id: "grip", shape: "box", size: [0.03, 0.11, 0.028], position: [-0.008, 0.055, 0], rotation: [0, 0, 12], roundness: 0.3, color: "#2f3236" },
			{ id: "frame", shape: "box", size: [0.17, 0.028, 0.026], position: [0.055, 0.118, 0], roundness: 0.2, color: "#2f3236" },
			{ id: "slide", shape: "box", size: [0.19, 0.032, 0.028], position: [0.06, 0.145, 0], roundness: 0.2, color: "#3d4247" },
			{ id: "guard", shape: "torus", size: [0.045, 0.035, 0.007], position: [0.035, 0.095, 0], color: "#2f3236" },
			{ id: "trigger", shape: "box", size: [0.006, 0.018, 0.006], position: [0.03, 0.095, 0], roundness: 0.3, color: "#1f2124" }] } },
		{ role: "flash", kind: "sphere", at: [MUZZLE[0] + 0.025, MUZZLE[1] - 0.015, 0], scale: [0.05, 0.03, 0.03], color: "#ffe08a",
			glow: { color: "#ffc04a", intensity: 8, halo: 2.5 }, switch: { visible: "muzzle_vis" }, showOnlyInTake: true },
		{ role: "light", kind: "point-light", at: [MUZZLE[0] + 0.04, MUZZLE[1], 0], light: { type: "point", color: "#ffd27a", intensity: 4, range: 6, flicker: 0, shadow: false },
			switch: { visible: "muzzle_vis" }, showOnlyInTake: true },
	],
};
