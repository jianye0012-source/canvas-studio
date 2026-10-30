#!/usr/bin/env node
// Physical grasp (#816), shapes: a sphere and a cylinder are round to the hand, not the box they sit in. The shape is
// derived from what every motion-scene entry already carries (renderer, half), so no field is added to an entry and a
// saved take source (which keeps whole entries) reads the same shapes.
import { motionScene } from "../../src/motion3/scene.js";
import { sdBox } from "../../src/motion3/qa/geometry.js";
import { buildKit } from "../../src/kits/index.js";
import { shapeOf, signedDistance, closestPoint, normalAt, capsuleDepth } from "../../src/motion3/shapes.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` - ${detail}`}`);
	if (!condition) failures += 1;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const entry = (renderer, half, pos = [0, 0, 0], R = I) => ({ renderer, half, pos, R });

// A 7.4 cm ball standing on the floor: its base pivot at the floor, its centre 0.037 m up.
const ball = entry("sphere", [0.037, 0.037, 0.037]);
expect("a sphere entry is a round sphere of its half", shapeOf(ball).kind === "sphere" && near(shapeOf(ball).r, 0.037, 1e-12), JSON.stringify(shapeOf(ball)));
expect("signed distance at the ball's centre is -r", near(signedDistance(ball, [0, 0.037, 0]), -0.037, 1e-6), signedDistance(ball, [0, 0.037, 0]));
expect("signed distance 5 cm off the centre is 1.3 cm", near(signedDistance(ball, [0.05, 0.037, 0]), 0.013, 1e-6), signedDistance(ball, [0.05, 0.037, 0]));
// the box it sits in says the diagonal point is inside the ball's skin; the sphere says it is outside
const diag = [0.033, 0.037 + 0.033, 0];
expect("a point inside the ball's box corner is outside the ball", sdBox(diag, ball) < 0 && signedDistance(ball, diag) > 0.008, `${sdBox(diag, ball)} ${signedDistance(ball, diag)}`);
const cp = closestPoint(ball, [0.1, 0.037, 0]);
expect("the closest point on the ball lies on its skin toward the query", near(cp[0], 0.037, 1e-9) && near(cp[1], 0.037, 1e-9), JSON.stringify(cp));
const n = normalAt(ball, [0, 0.2, 0]);
expect("the ball's normal points from its centre to the query", near(n[1], 1, 1e-9), JSON.stringify(n));

// A can: r 3.3 cm, 12 cm tall, its axis along its local +Y, turned 90 deg so it lies along x.
const Rz90 = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
const can = entry("cylinder", [0.033, 0.06, 0.033], [0, 0.5, 0], Rz90);
expect("a cylinder entry is a round cylinder", shapeOf(can).kind === "cylinder" && near(shapeOf(can).r, 0.033, 1e-12) && near(shapeOf(can).h, 0.12, 1e-12), JSON.stringify(shapeOf(can)));
// the base pivot is at the bottom of the local Y axis, which now points along -x: the centre sits at x = -0.06
const canCentre = [-0.06, 0.5, 0];
expect("1 cm off the can's side is 1 cm", near(signedDistance(can, [canCentre[0], 0.5 + 0.043, 0]), 0.01, 1e-6), signedDistance(can, [canCentre[0], 0.543, 0]));
expect("1 cm past the can's cap is 1 cm", near(signedDistance(can, [canCentre[0] - 0.07, 0.5, 0]), 0.01, 1e-6), signedDistance(can, [-0.13, 0.5, 0]));
expect("inside the can is negative", signedDistance(can, canCentre) < 0, signedDistance(can, canCentre));

// A sphere renderer scaled unevenly is an ellipsoid: treated as its box, never as a wrong sphere.
expect("an uneven sphere (0.037/0.037/0.05) is a box", shapeOf(entry("sphere", [0.037, 0.037, 0.05])).kind === "box");

// Boxes keep today's maths bit for bit.
let seed = 7, worst = 0;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
const box = entry("cube", [0.2, 0.1, 0.3], [0.1, 0.4, -0.2], [[0.8, -0.6, 0], [0.6, 0.8, 0], [0, 0, 1]]);
for (let i = 0; i < 200; i++) { const p = [rnd(), rnd() + 0.4, rnd()]; worst = Math.max(worst, Math.abs(signedDistance(box, p) - sdBox(p, box))); }
expect("a box's signed distance equals sdBox on 200 points", worst < 1e-9, worst);

// A capsule: its depth is how far its skin goes into the shape (positive), or the gap (negative).
expect("a 9 mm capsule whose line is 1 cm off the ball has a 1 mm gap (depth -1 mm)", near(capsuleDepth(ball, [0.047, 0.037, -0.02], [0.047, 0.037, 0.02], 0.009), -0.001, 1e-6),
	capsuleDepth(ball, [0.047, 0.037, -0.02], [0.047, 0.037, 0.02], 0.009));
expect("the same capsule 5 mm into the ball has depth 5 mm", near(capsuleDepth(ball, [0.041, 0.037, 0], [0.041, 0.037, 0], 0.009), 0.005, 1e-6),
	capsuleDepth(ball, [0.041, 0.037, 0], [0.041, 0.037, 0], 0.009));

// The ball kit's motion-scene entry is a sphere, and the entry carries no new field.
const kit = buildKit("ball", []), scene = motionScene(kit.records), body = scene.objects[kit.parts.body];
expect("the ball kit's body is a sphere of radius 3.7 cm", shapeOf(body).kind === "sphere" && near(shapeOf(body).r, 0.037, 1e-9), JSON.stringify(shapeOf(body)));
expect("a motion-scene entry carries no shape field (saved take sources stay as they are)",
	JSON.stringify(Object.keys(body).sort()) === JSON.stringify(["ancestorPoses", "ancestors", "half", "name", "pos", "R", "renderer"].sort()), Object.keys(body).join());

if (failures) { console.log(`${failures} shape check(s) failed`); process.exit(1); }
console.log("motion3 shapes: all checks passed");
