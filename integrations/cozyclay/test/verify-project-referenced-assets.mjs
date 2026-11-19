import assert from "node:assert/strict";
import { test } from "node:test";
import { readProjectDocument } from "../src/project.js";
import { SCENES_VERSION } from "../src/scenes.js";

const read = assets => readProjectDocument(JSON.stringify({ app: "cozyclay", kind: "project", version: 5, name: "t", scenes: { version: SCENES_VERSION, activeSceneId: null, scenes: [] }, resources: { assets } }));
const image = { id: "img-" + "b".repeat(32), type: "image/png", name: "", width: 512, height: 512, role: "workflow-output", size: 20480 };

test("C1 无字节引用保留图片尺寸、用途和size", () => {
	const result = read([image]);
	assert.equal(result.ok, true);
	assert.equal(result.project.assets.length, 1);
	assert.equal(result.project.assets[0].bytes, undefined);
	assert.deepEqual(result.project.assets[0], image);
	assert.deepEqual(result.problems, []);
});

test("C2 带base64的旧模型条目仍解码为ArrayBuffer", () => {
	const result = read([{ id: "mesh-" + "a".repeat(32), type: "model/gltf-binary", bytes: "YWJj" }]);
	assert.equal(result.ok, true);
	assert.equal(result.project.assets.length, 1);
	assert.ok(result.project.assets[0].bytes instanceof ArrayBuffer);
	assert.equal(result.project.assets[0].bytes.byteLength, 3);
	assert.deepEqual(new Uint8Array(result.project.assets[0].bytes), new Uint8Array([97, 98, 99]));
});

test("C3 缺少字节和有效size、非法编号的条目按原错误丢弃", () => {
	const result = read([
		{ id: "mesh-" + "a".repeat(32), type: "model/gltf-binary" },
		{ ...image, size: 0 },
		{ ...image, id: "img-invalid" },
	]);
	assert.deepEqual(result.project.assets, []);
	assert.deepEqual(result.problems.map(problem => problem.code), ["bad-base64", "bad-base64", "bad-id"]);
});

test("C4 无字节引用重复编号只保留一条并报告duplicate", () => {
	const result = read([image, image]);
	assert.deepEqual(result.project.assets, [image]);
	assert.deepEqual(result.problems.map(problem => problem.code), ["duplicate"]);
});
