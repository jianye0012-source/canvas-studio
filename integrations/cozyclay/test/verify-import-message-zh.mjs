#!/usr/bin/env node
import assert from "node:assert/strict";

Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "zh" } });
const { localizedImportMessage } = await import("../src/domains/import-message.js");

for (const [message, expected] of [
	["Not imported: Could not import that model: That model has no measurable geometry", "导入失败：模型没有可测量的几何体"],
	["Not imported: Could not import that model: That model is too large to import — larger than 100 MB", "导入失败：模型过大，超过 100 MB，无法导入"],
	["Not imported: Could not import that model: That file is not a GLB model", "导入失败：文件不是 GLB 模型"],
	["Not imported: Could not import that model: That FBX file is too old to import", "导入失败：FBX 文件版本过旧，无法导入"],
	["Not imported: Could not import that image: Unknown image failure", "导入失败：Unknown image failure"],
	["Not imported: Could not import that model: 此模型使用 KTX2 压缩纹理", "导入失败：此模型使用 KTX2 压缩纹理"],
]) assert.equal(localizedImportMessage(message), expected);

console.log("PASS Chinese import notifications preserve model receipts and unknown reasons");
