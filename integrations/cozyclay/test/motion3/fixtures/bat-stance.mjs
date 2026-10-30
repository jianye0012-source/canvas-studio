// Two Studio agent runs of "야구 배트를 휘두르는 모습을 만들어줘" on the same bat kit (lane N1), rebuilt
// from the session logs (the first full spec, then each call's patch plus the patches its repair
// applied; each literal compiles to the specId the session installed). Both swing with aim keys
// without roll and a straight FK right arm (no armw_r): the keys lead that hand.
//   STANCE_SPEC  session d5c110a7 (build b8d8ac55), spec-f46b8389f1fc, the kit `empty` left at the
//                origin: the stance and the load hold the grip 10 to 13 cm from the right shoulder.
//                Installed at QA 110 after 5 compiles: REACH "empty: 53.4 cm off its keys" f0-57,
//                COLLIDE hand_l x empty, BODY hand_l into torso_lo / torso_hi, GRAB 63.6 cm, POPs.
//                The left hand reaches the bat (reachGrip, 2 frames) and holds it to f60.
//   CLEAN_SPEC   session f0f2be59 (build d77d1566), spec-765240635845, the kit at (-0.3, 0.9, 0.3):
//                QA 0 after 8 compiles; the left hand fits the bat from f0 (w_batLow_l).
// char-a is the Y Bot at the origin, yaw 0 (bat-aim-swing.mjs CHARACTER, batKit).
// Units: metres, +Y up; a record's position is its base pivot.

export const STANCE_SPEC_ID = "spec-f46b8389f1fc", CLEAN_SPEC_ID = "spec-765240635845";
export const STANCE_KIT_AT = [0, 0, 0], CLEAN_KIT_AT = [-0.3, 0.9, 0.3];

export const STANCE_SPEC = {
	"schema": "cozyclay.motion-spec.v1",
	"fps": 24,
	"frames": 66,
	"label": "baseball bat swing",
	"props": {"batGrip":{"hand":"r","origin":["RightHandIndex2","RightHandMiddle2"],"points":{"low":[0,-0.0425,-0.0736],"knob":[0,-0.07,-0.1212],"tip":[0,0.35,0.6062]}}},
	"use": [{"skill":"reachGrip","f0":0,"args":{"anchor":"batLow","side":"l","reach":2,"hold":58,"release":4,"define":{"kind":"prop","prop":"batGrip","point":"low"}}}],
	"objects": {
		"empty": {"prop":"batGrip","at":[0,-0.07,-0.1212],"along":[0,0.5,0.866],"grab":0, "keys": [
			{"f":0,"pos":[-0.2,1.32,0.2],"aim":[-0.2,0.85,-0.5]},
			{"f":14,"pos":[-0.21,1.33,0.19],"aim":[-0.15,0.85,-0.52]},
			{"f":22,"pos":[-0.3,1.38,0.1],"aim":[-0.05,0.62,-0.78]},
			{"f":27,"pos":[-0.1,1.15,0.35],"aim":[-0.9,0.15,-0.3]},
			{"f":30,"pos":[0.05,1,0.45],"aim":[0.15,-0.05,1]},
			{"f":33,"pos":[0.25,1.08,0.35],"aim":[0.9,0.1,0.25]},
			{"f":39,"pos":[0.42,1.42,-0.1],"aim":[-0.35,0.65,-0.68]},
			{"f":65,"pos":[0.42,1.42,-0.1],"aim":[-0.35,0.65,-0.68]},
		] },
	},
	"keys": [
		{"f":0,"set":{"root":[-0.0117,0.92,0.0697],"yaw":-10,"pitch":15,"spine_yaw":-5,"head_yaw":60,"head_pitch":-5,"foot_l":[0.3,0.105,0],"foot_r":[-0.3,0.105,0],"fyaw_l":10,"fyaw_r":-5,"knee_l":[0.3,0,1],"knee_r":[-0.3,0,1],"elbow_r":[-1,0.3,-0.2]}},
		{"f":14,"set":{"root":[-0.0317,0.92,0.0697],"foot_l":[0.3,0.105,0]}},
		{"f":20,"set":{"root":[-0.1317,0.93,0.0697],"yaw":-18,"spine_yaw":-10,"foot_l":[0.38,0.17,0]}},
		{"f":25,"set":{"root":[0.0283,0.89,0.0697],"yaw":0,"foot_l":[0.46,0.105,0.02]}},
		{"f":30,"set":{"root":[0.0883,0.88,0.0697],"yaw":40,"spine_yaw":15,"head_yaw":20,"fpitch_r":0,"fyaw_r":-5}},
		{"f":34,"set":{"fpitch_r":45,"fyaw_r":35}},
		{"f":39,"set":{"root":[0.1183,0.9,0.0697],"yaw":70,"spine_yaw":25,"head_yaw":-20,"fpitch_r":50}},
		{"f":65,"set":{"root":[0.1183,0.9,0.0697],"yaw":70,"spine_yaw":25}},
	],
	"goals": [{"name":"bat moves through the swing","moved":"object:empty","by":0.4,"at":[22,39]},{"name":"bat tip out over the plate at contact","near":["prop:batGrip.tip","anchor:contact"],"tol":0.3,"at":[29,31],"mode":"any"}],
	"anchors": {"contact":{"kind":"world","p":[0.18,0.96,1.28]}},
};

export const CLEAN_SPEC = {
	"schema": "cozyclay.motion-spec.v1",
	"fps": 24,
	"frames": 84,
	"label": "baseball swing",
	"props": {"batGrip":{"hand":"r","origin":["RightHandIndex2","RightHandMiddle2"],"points":{"low":[0,-0.0425,-0.0736],"knob":[0,-0.07,-0.1212],"tip":[0,0.35,0.6062]}}},
	"anchors": {"batLow":{"kind":"prop","prop":"batGrip","point":"low","offset":[-0.0421,0.0024,0.0175]},"contactZone":{"kind":"world","p":[0.03,1,0.33]}},
	"fits": [{"side":"l","anchor":"batLow","effector":{"joints":["LeftHandIndex2","LeftHandMiddle2"]}}],
	"objects": {
		"empty": {"prop":"batGrip","at":[0,-0.07,-0.1212],"along":[0,0.5,0.866], "keys": [
			{"f":0,"pos":[-0.2,1.25,0.25],"aim":[-0.15,0.85,-0.5]},
			{"f":16,"pos":[-0.28,1.3,0.26],"aim":[-0.05,0.8,-0.6]},
			{"f":26,"pos":[-0.3,1.32,0.22],"aim":[0,0.78,-0.62]},
			{"f":30,"pos":[-0.25,1.22,0.25],"aim":[-0.3,0.6,-0.7]},
			{"f":33,"pos":[-0.11,1.1,0.27],"aim":[-0.85,0.25,-0.25]},
			{"f":36,"pos":[0.03,1,0.33],"aim":[0,-0.08,1]},
			{"f":40,"pos":[0.32,1.05,0.3],"aim":[0.75,0.15,0.6]},
			{"f":48,"pos":[0.45,1.32,0.08],"aim":[-0.26,0.6,-0.67]},
			{"f":66,"pos":[0.45,1.34,0.06],"aim":[-0.3,0.58,-0.68]},
			{"f":83,"pos":[0.45,1.34,0.06],"aim":[-0.3,0.58,-0.68]},
		] },
	},
	"checks": {"allow":[{"part":"hand_l","object":"empty","depth":0.05},{"part":"hand_l","object":"sculpt","depth":0.05}],"limits":{"accLimb":0.35,"flip":75}},
	"keys": [
		{"f":0,"set":{"root":[0,0.93,0],"yaw":0,"spine_yaw":-10,"pitch":12,"head_yaw":25,"foot_l":[0.32,0.105,0],"foot_r":[-0.3,0.105,0],"fyaw_l":10,"fyaw_r":0,"knee_l":[0.3,0,1],"knee_r":[-0.3,0,1],"armw_l":1,"w_batLow_l":1,"fingers_l":{"grip":1},"fingers_r":{"grip":1}}},
		{"f":16,"set":{"root":[-0.1,0.93,0],"yaw":-12,"spine_yaw":-18,"head_yaw":35,"foot_l":[0.32,0.105,0]}},
		{"f":22,"set":{"root":[-0.12,0.93,0],"foot_l":[0.36,0.17,0]}},
		{"f":26,"set":{"elbow_r":[-0.4,-1,-0.2]}},
		{"f":28,"set":{"root":[-0.04,0.91,0],"foot_l":[0.42,0.105,0],"yaw":-10,"spine_yaw":-20,"head_yaw":38}},
		{"f":34,"set":{"elbow_r":[-0.4,-1,-0.2]}},
		{"f":36,"set":{"root":[0.08,0.9,0],"yaw":25,"spine_yaw":10,"head_yaw":20,"fyaw_r":20,"fpitch_r":20}},
		{"f":40,"set":{"yaw":40,"spine_yaw":20,"head_yaw":15}},
		{"f":48,"set":{"root":[0.1,0.93,0],"yaw":55,"spine_yaw":20,"pitch":6,"head_yaw":5,"fyaw_r":45,"fpitch_r":45}},
		{"f":83,"set":{"root":[0.1,0.94,0],"yaw":55,"spine_yaw":20,"pitch":5,"head_yaw":5,"fyaw_r":45,"fpitch_r":45}},
	],
	"fix": {"retime":true},
	"goals": [{"name":"left hand stays on the bat","near":["joint:LeftHandMiddle2","anchor:batLow"],"tol":0.06,"at":[0,83]},{"name":"bat knob meets the contact zone","near":["prop:batGrip.knob","anchor:contactZone"],"tol":0.1,"at":36}],
};
