// The baseball swings of two Studio agent runs of "야구 배트를 휘두르는 모습을 만들어줘" (lane K8).
// Both use the bat kit (object.createKit "bat": the group `empty`, the body `sculpt`, the trail
// `effect`) on char-a (Y Bot at the origin, yaw 0), rebuilt from the session logs (base + patch +
// the repair's patches; each literal compiles to the specId the session installed).
//   SWING_SPEC    session 16d12ba9 (after aim keys, C16), spec-c66116660dc4: nine aim keys without
//                 roll for a right-handed swing, stance to follow-through; the kit moved to the
//                 hand (-0.26, 1.25, 0.3). Installed at QA 115 with REACH "empty: 77.0 cm off its
//                 keys" (the wrist deviation needed 121 deg) and the goal "bat swings through" failing.
//   EARLIER_SPEC  session 6912547c (before aim keys), spec-86cfd6cf7fae: 38 rot keys the agent wrote
//                 with quaternion scripts; the kit at (-0.3, 0, 0.3). Installed at QA 35, REACH 12.0 cm.
// Units: metres, +Y up; a record's position is its base pivot.

export const CHARACTER = { id: "char-a", model: "y-bot-tpose", subject: "a young woman in a tan coat", x: 0, y: 0, z: 0, rot: 0, scale: 1 };
export const BAT = "empty";
export const SWING_SPEC_ID = "spec-c66116660dc4", EARLIER_SPEC_ID = "spec-86cfd6cf7fae";

/** The kit's records at [x, y, z]: the group root, the 0.84 m body (its parts' bounds) and the trail emitter (no box). */
export function batKit([x, y, z]) {
	const rec = (id, name, renderer, dy, size, parent) => ({ id, name, renderer, x, y: y + dy, z, rot: 0, rotX: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1,
		footprint: { width: size[0], depth: size[2] }, height: size[1], parent });
	return [rec("empty", "Baseball Bat", "empty", 0, [0, 0, 0], null), rec("sculpt", "Baseball Bat body", "sculpt", 0, [0.067, 0.84, 0.067], "empty"),
		rec("effect", "Baseball Bat trail", "effect", 0.69, [0, 0, 0], "empty")];
}
export const SWING_KIT_AT = [-0.26, 1.25, 0.3], EARLIER_KIT_AT = [-0.3, 0, 0.3];

export const SWING_SPEC = {
	"schema": "cozyclay.motion-spec.v1",
	"fps": 24,
	"frames": 64,
	"label": "baseball swing (RH batter)",
	"props": {"batGrip":{"hand":"r","origin":["RightHandIndex2","RightHandMiddle2"],"points":{"low":[0,-0.0425,-0.0736],"knob":[0,-0.07,-0.1212],"tip":[0,0.35,0.6062]}}},
	"anchors": {"batLow":{"kind":"prop","prop":"batGrip","point":"low","offset":[0.0495,-0.0125,-0.0115]},"zone":{"kind":"world","p":[0.05,0.93,1.1]}},
	"goals": [{"name":"bat sweeps the hitting zone","near":["prop:batGrip.tip","anchor:zone"],"tol":0.25,"at":[25,29],"mode":"any"},{"name":"left hand stays on bat","near":["joint:LeftHand","prop:batGrip.low"],"tol":0.1,"at":[0,63]},{"name":"bat swings through","moved":"object:empty","by":0.4,"at":[20,31]}],
	"checks": {"allow":[{"part":"hand","object":"empty","depth":0.06},{"part":"farm_l","object":"empty","depth":0.04}]},
	"objects": {
		"empty": { "prop":"batGrip","at":[0,-0.07,-0.1212],"along":[0,0.5,0.866],"grab":0, "keys": [
			{"f":0,"pos":[-0.26,1.25,0.3],"aim":[0.44,0.79,-0.43]},
			{"f":12,"pos":[-0.3,1.3,0.3],"aim":[0.5,0.8,-0.3]},
			{"f":20,"pos":[-0.26,1.18,0.42],"aim":[0.25,0.8,-0.55]},
			{"f":24,"pos":[-0.12,1.06,0.48],"aim":[-0.35,0.5,0.8]},
			{"f":27,"pos":[0.04,0.98,0.45],"aim":[0.05,-0.1,1]},
			{"f":31,"pos":[0.24,1.02,0.36],"aim":[0.9,0.05,0.35]},
			{"f":38,"pos":[0.36,1.3,0.26],"aim":[0.3,0.45,-0.84]},
			{"f":46,"pos":[0.38,1.38,0.24],"aim":[-0.25,0.5,-0.83]},
			{"f":63,"pos":[0.38,1.38,0.24],"aim":[-0.25,0.5,-0.83]},
		] },
	},
	"keys": [
		{"f":0,"set":{"root":[-0.1005,0.93,0.0189],"yaw":0,"pitch":15,"spine_yaw":-20,"head_yaw":65,"head_pitch":5,"foot_l":[0.36,0.1165,0.02],"foot_r":[-0.3,0.1165,0],"fyaw_l":15,"fyaw_r":10,"knee_l":[0.4,0,1],"knee_r":[-0.3,0,1],"armw_r":1,"armw_l":1,"w_batLow_l":1,"fingers_r":{"grip":1},"fingers_l":{"grip":1},"elbow_r":[-1,-0.6,-0.2],"elbow_l":[0.3,-1,0.3]}},
		{"f":12,"set":{"root":[-0.1705,0.94,0.0189],"spine_yaw":-30,"head_yaw":75,"foot_l":[0.3,0.17,0.02],"fpitch_l":20}},
		{"f":20,"set":{"root":[-0.0905,0.92,0.0189],"spine_yaw":-25,"head_yaw":70,"foot_l":[0.46,0.1009,0.02],"fpitch_l":0}},
		{"f":27,"set":{"root":[-0.0105,0.91,0.0189],"yaw":0,"spine_yaw":15,"pitch":18,"head_yaw":40,"head_pitch":15,"fpitch_r":20,"fyaw_r":30,"elbow_r":[-0.3,-1,0.2],"elbow_l":[0.5,-1,0]}},
		{"f":31,"set":{"root":[0.0195,0.92,0.0189],"spine_yaw":35,"head_yaw":20,"fpitch_r":35,"fyaw_r":45}},
		{"f":38,"set":{"root":[0.0295,0.95,0.0189],"spine_yaw":55,"pitch":10,"head_yaw":10,"head_pitch":5,"fpitch_r":45,"fyaw_r":60,"elbow_r":[0.2,-0.5,1],"elbow_l":[1,-0.3,-0.3]}},
		{"f":46,"set":{"root":[0.0295,0.96,0.0189],"spine_yaw":60,"pitch":8,"head_yaw":15}},
		{"f":63,"set":{"root":[0.0295,0.96,0.0189],"spine_yaw":60,"pitch":8,"head_yaw":15,"fpitch_r":45,"fyaw_r":60}},
		{"f":38,"set":{"foot_r":[-0.2996,0.1507,0.0007]}},
	],
};

export const EARLIER_SPEC = {
	"schema": "cozyclay.motion-spec.v1",
	"fps": 24,
	"frames": 72,
	"label": "baseball bat swing",
	"fix": {"retime":false},
	"props": {"batGrip":{"hand":"r","origin":["RightHandIndex2","RightHandMiddle2"],"points":{"low":[0,-0.0425,-0.0736],"knob":[0,-0.07,-0.1212],"tip":[0,0.35,0.6062]}}},
	"anchors": {"batLow":{"kind":"prop","prop":"batGrip","point":"low","offset":[-0.0033,0.0011,0.0158]}},
	"checks": {"allow":[{"part":"hand","object":"empty","depth":0.06},{"part":"farm","object":"empty","depth":0.07},{"part":"uarm_l","object":"empty","depth":0.07}]},
	"goals": [{"name":"bat swings through the zone","moved":"object:empty","by":0.8,"at":[28,40]},{"name":"both hands on the bat","near":["joint:LeftHand","joint:RightHand"],"tol":0.22,"at":[0,71]}],
	"objects": {
		"empty": { "prop":"batGrip","at":[0,-0.07,-0.1212],"along":[0,0.5,0.866], "keys": [
			{"f":0,"pos":[-0.22,1.26,0],"rot":[0.0815,0.8385,-0.4118,-0.3473]},
			{"f":2,"pos":[-0.2207,1.2607,-0.0007],"rot":[0.0818,0.8381,-0.4127,-0.3472]},
			{"f":4,"pos":[-0.2226,1.2626,-0.0026],"rot":[0.0826,0.8371,-0.4149,-0.3468]},
			{"f":6,"pos":[-0.225,1.265,-0.005],"rot":[0.0837,0.8358,-0.4178,-0.3462]},
			{"f":8,"pos":[-0.2274,1.2674,-0.0074],"rot":[0.0848,0.8345,-0.4206,-0.3457]},
			{"f":10,"pos":[-0.2293,1.2693,-0.0093],"rot":[0.0857,0.8335,-0.4228,-0.3452]},
			{"f":12,"pos":[-0.23,1.27,-0.01],"rot":[0.086,0.8331,-0.4237,-0.3451]},
			{"f":14,"pos":[-0.2331,1.2731,-0.0131],"rot":[0.0873,0.8313,-0.4276,-0.3443]},
			{"f":16,"pos":[-0.24,1.28,-0.02],"rot":[0.0902,0.8272,-0.436,-0.3427]},
			{"f":18,"pos":[-0.2469,1.2869,-0.0269],"rot":[0.093,0.8231,-0.4445,-0.341]},
			{"f":20,"pos":[-0.25,1.29,-0.03],"rot":[0.0943,0.8212,-0.4483,-0.3402]},
			{"f":22,"pos":[-0.2484,1.2884,-0.0284],"rot":[0.0941,0.8218,-0.4472,-0.3404]},
			{"f":24,"pos":[-0.245,1.285,-0.025],"rot":[0.0936,0.8229,-0.4448,-0.3409]},
			{"f":26,"pos":[-0.2416,1.2816,-0.0216],"rot":[0.0931,0.8241,-0.4423,-0.3414]},
			{"f":28,"pos":[-0.24,1.28,-0.02],"rot":[0.0928,0.8246,-0.4413,-0.3416]},
			{"f":30,"pos":[-0.185,1.205,0.06],"rot":[-0.122,0.7964,-0.4919,-0.3299]},
			{"f":32,"pos":[-0.13,1.13,0.14],"rot":[-0.3428,0.7457,-0.4806,-0.3089]},
			{"f":34,"pos":[-0.02,1.05,0.28],"rot":[-0.6621,0.5134,-0.1854,-0.5134]},
			{"f":35,"pos":[0.08,1.02,0.35],"rot":[-0.7267,0.2571,0.1438,-0.6206]},
			{"f":36,"pos":[0.1448,1.0304,0.3215],"rot":[-0.7087,0.1275,0.1932,-0.6665]},
			{"f":38,"pos":[0.33,1.06,0.24],"rot":[-0.6323,-0.2706,0.3165,-0.6533]},
			{"f":40,"pos":[0.3522,1.1785,0.0622],"rot":[-0.0042,-0.5409,0.5164,-0.6639]},
			{"f":42,"pos":[0.3393,1.2485,-0.0519],"rot":[0.4422,-0.5866,0.3408,-0.5866]},
			{"f":44,"pos":[0.28,1.33,-0.2],"rot":[0.6547,-0.4711,-0.3571,-0.4711]},
			{"f":46,"pos":[0.2798,1.3303,-0.2002],"rot":[0.6548,-0.471,-0.3571,-0.471]},
			{"f":48,"pos":[0.2794,1.3312,-0.2006],"rot":[0.655,-0.4708,-0.3573,-0.4708]},
			{"f":50,"pos":[0.2787,1.3325,-0.2013],"rot":[0.6555,-0.4704,-0.3575,-0.4704]},
			{"f":52,"pos":[0.2779,1.3342,-0.2021],"rot":[0.656,-0.4699,-0.3578,-0.4699]},
			{"f":54,"pos":[0.2769,1.3362,-0.2031],"rot":[0.6567,-0.4693,-0.3582,-0.4693]},
			{"f":56,"pos":[0.2758,1.3383,-0.2042],"rot":[0.6574,-0.4687,-0.3586,-0.4687]},
			{"f":58,"pos":[0.2747,1.3406,-0.2053],"rot":[0.6581,-0.468,-0.3589,-0.468]},
			{"f":60,"pos":[0.2736,1.3427,-0.2064],"rot":[0.6588,-0.4674,-0.3593,-0.4674]},
			{"f":62,"pos":[0.2726,1.3448,-0.2074],"rot":[0.6594,-0.4668,-0.3597,-0.4668]},
			{"f":64,"pos":[0.2717,1.3467,-0.2083],"rot":[0.66,-0.4662,-0.36,-0.4662]},
			{"f":66,"pos":[0.2709,1.3482,-0.2091],"rot":[0.6605,-0.4658,-0.3603,-0.4658]},
			{"f":68,"pos":[0.2703,1.3493,-0.2097],"rot":[0.6609,-0.4654,-0.3605,-0.4654]},
			{"f":70,"pos":[0.27,1.3499,-0.21],"rot":[0.6611,-0.4653,-0.3606,-0.4653]},
			{"f":71,"pos":[0.27,1.35,-0.21],"rot":[0.6611,-0.4652,-0.3606,-0.4652]},
		] },
	},
	"keys": [
		{"f":0,"set":{"root":[0,0.92,0.03],"yaw":0,"pitch":12,"spine_yaw":-10,"head_yaw":60,"foot_l":[0.34,0.095,0],"foot_r":[-0.34,0.095,0],"fyaw_l":15,"fyaw_r":0,"fpitch_l":0,"fpitch_r":0,"knee_l":[0.3,0,1],"knee_r":[-0.3,0,1],"armw_r":1,"armw_l":1,"w_batLow_l":1,"elbow_l":[0.2,-1,0.5],"fingers_r":{"grip":1},"fingers_l":{"grip":1},"elbow_r":[-1,0,0]}},
		{"f":12,"set":{"root":[-0.03,0.92,0.03],"spine_yaw":-12,"head_yaw":62,"elbow_r":[-1,0,0]}},
		{"f":20,"set":{"root":[-0.07,0.93,0.03],"yaw":-12,"spine_yaw":-15,"head_yaw":72,"foot_l":[0.3,0.14,0],"elbow_r":[0,-1,0]}},
		{"f":28,"set":{"root":[0.02,0.9,0.03],"yaw":-5,"spine_yaw":-12,"head_yaw":68,"foot_l":[0.48,0.095,0],"elbow_r":[0,-1,0]}},
		{"f":32,"set":{"root":[0.07,0.89,0.05],"yaw":15,"spine_yaw":0,"head_yaw":55,"elbow_r":[0,-1,0]}},
		{"f":34,"set":{"elbow_r":[-0.5,-0.5,-0.7]}},
		{"f":35,"set":{"root":[0.1,0.89,0.07],"yaw":40,"spine_yaw":10,"head_yaw":35,"fyaw_r":30,"fpitch_r":20,"foot_r":[-0.34,0.11,0],"elbow_r":[-0.5,-0.5,-0.7]}},
		{"f":38,"set":{"root":[0.15,0.9,0.09],"yaw":65,"spine_yaw":15,"head_yaw":15,"fyaw_r":55,"fpitch_r":35,"foot_r":[-0.34,0.13,0],"elbow_l":[0.6,-0.6,0],"elbow_r":[-0.5,-0.5,-0.7]}},
		{"f":41,"set":{"elbow_r":[-1,-1,0]}},
		{"f":44,"set":{"root":[0.13,0.92,0.05],"yaw":85,"spine_yaw":20,"head_yaw":0,"fyaw_r":70,"fpitch_r":45,"foot_r":[-0.34,0.15,0],"elbow_l":[0.8,-0.3,-0.3],"elbow_r":[-1,-1,0]}},
		{"f":71,"set":{"root":[0.13,0.93,0.05],"yaw":88,"spine_yaw":18,"head_yaw":0,"elbow_r":[-1,-1,0]}},
		{"f":0,"set":{"elbow_r":[0,-1,0]}},
		{"f":12,"set":{"elbow_r":[0,-1,0]}},
		{"f":20,"set":{"elbow_r":[0,-1,0]}},
		{"f":28,"set":{"elbow_r":[0,-1,0]}},
		{"f":32,"set":{"elbow_r":[0,-1,0]}},
		{"f":34,"set":{"elbow_r":[-0.5,-0.5,-0.7]}},
		{"f":35,"set":{"elbow_r":[-0.5,-0.5,-0.7]}},
		{"f":38,"set":{"elbow_r":[-0.5,-0.5,-0.7]}},
		{"f":41,"set":{"elbow_r":[-1,-1,0]}},
		{"f":44,"set":{"elbow_r":[-1,-1,0]}},
		{"f":71,"set":{"elbow_r":[-1,-1,0]}},
	],
};
