// The Studio agent run of "야구 배트를 휘두르는 모습을 만들어줘" in session df6acdcc (lane P2), rebuilt from the
// session log (the first full spec, then each call's patch plus the patches its repair applied; the
// literal compiles to the specId the session installed). The bat kit (object.createKit "bat":
// `empty`, `sculpt`, `effect`) was made at (0.3, 0, 0.3); char-a is the Y Bot at the origin, yaw 0.
//   FOLD_SPEC  spec-9879beb1f6ce, installed at QA 4 without checks.limits: POP LeftForeArm 5.95 cm/f^2 f31
//              (the left elbow's launch into the swing), FLIP RightForeArm 71 deg f35 (the load keys the
//              bat at the right shoulder, so the right elbow folds to 165-171 deg over f34-35 and its
//              plane turns with the wrist passing the shoulder), FLIP LeftForeArm 60 deg f11 (the left hand
//              reaching the handle, reachGrip reach 10), COLLIDE torso_hi x empty f30.
// Units: metres, +Y up; a record's position is its base pivot.

export const FOLD_SPEC_ID = "spec-9879beb1f6ce", FOLD_KIT_AT = [0.3, 0, 0.3];

export const FOLD_SPEC = {
	"schema": "cozyclay.motion-spec.v1",
	"fps": 24,
	"frames": 72,
	"label": "baseball swing",
	"props": {"batGrip":{"hand":"r","origin":["RightHandIndex2","RightHandMiddle2"],"points":{"low":[0,-0.0425,-0.0736],"knob":[0,-0.07,-0.1212],"tip":[0,0.35,0.6062]}}},
	"anchors": {"lgrip":{"kind":"prop","prop":"batGrip","point":"low","offset":[-0.0351,-0.0224,-0.0141]}},
	"use": [{"skill":"reachGrip","f0":0,"args":{"anchor":"lgrip","side":"l","reach":10,"hold":34,"release":12}}],
	"objects": {
		"empty": {"prop":"batGrip","at":[0,-0.07,-0.1212],"along":[0,0.5,0.866],"grab":0, "keys": [
			{"f":0,"pos":[-0.22,1.28,0.22],"aim":[-0.3,0.9,-0.3]},
			{"f":24,"pos":[-0.22,1.3,0.2],"aim":[-0.2,0.9,-0.4]},
			{"f":31,"pos":[-0.32,1.36,0.16],"aim":[0.35,0.7,-0.6]},
			{"f":36,"pos":[-0.12,1.12,0.35],"aim":[-0.55,0.3,-0.75]},
			{"f":39,"pos":[0.01,0.97,0.47],"aim":[0.1,-0.1,1]},
			{"f":42,"pos":[0.3,1.05,0.38],"aim":[1,0.05,0.3]},
			{"f":48,"pos":[0.37,1.32,-0.02],"aim":[-0.8,0.3,-0.5]},
			{"f":71,"pos":[0.37,1.32,-0.02],"aim":[-0.8,0.3,-0.5]},
		] },
		"effect": {"visible":"trail_vis"},
	},
	"keys": [
		{"f":0,"set":{"root":[0.0056,0.9,0.1851],"foot_l":[0.36,0.105,0],"foot_r":[-0.36,0.105,0],"yaw":0,"spine_yaw":-10,"spine_pitch":10,"head_yaw":60,"fyaw_l":20,"fyaw_r":0,"fpitch_r":0,"trail_vis":0,"elbow_r":[-0.7,-0.7,0]}},
		{"f":24,"set":{"root":[-0.0244,0.9,0.1851],"foot_l":[0.36,0.105,0],"spine_yaw":-15,"head_yaw":65}},
		{"f":30,"set":{"root":[-0.18,0.9,0.1851],"foot_l":[0.3,0.22,0.02],"spine_yaw":-30,"yaw":-12,"head_yaw":75}},
		{"f":34,"set":{"root":[0.0556,0.88,0.1851],"foot_l":[0.55,0.105,0],"spine_yaw":-25,"yaw":0,"trail_vis":1},"step":["trail_vis"]},
		{"f":39,"set":{"root":[0.1056,0.87,0.1851],"spine_yaw":5,"yaw":35,"head_yaw":40,"fpitch_r":25,"fyaw_r":30}},
		{"f":44,"set":{"root":[0.1356,0.88,0.1851],"spine_yaw":30,"yaw":60,"head_yaw":20,"fpitch_r":45,"fyaw_r":60}},
		{"f":52,"set":{"root":[0.1456,0.9,0.1851],"spine_yaw":30,"yaw":65,"head_yaw":0,"spine_pitch":3,"fpitch_r":50,"fyaw_r":75,"trail_vis":0},"step":["trail_vis"]},
		{"f":71,"set":{"root":[0.1456,0.92,0.1851],"spine_yaw":28,"yaw":65,"head_yaw":0,"spine_pitch":5,"fpitch_r":50,"fyaw_r":75}},
	],
	"goals": [{"name":"bat swings through","moved":"object:empty","by":0.3,"at":[31,48]},{"name":"left hand on bat","near":["prop:lgripGrip.fingers","anchor:lgrip"],"tol":0.05,"at":[20,42]}],
	"fix": {"retime":true},
};
