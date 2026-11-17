import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { directorOutputError } from "./canvas-director-output";

describe("directorOutputError", () => {
    it("截图带真实原因", () => {
        assert.equal(
            directorOutputError("截图", new Error("截图未能保存到磁盘，请恢复数据目录后重试")),
            "截图发送到画布失败：截图未能保存到磁盘，请恢复数据目录后重试",
        );
    });

    it("非 Error 返回未知错误", () => {
        assert.equal(directorOutputError("视频", "oops"), "视频发送到画布失败：未知错误");
    });

    it("原因最多 200 字", () => {
        const message = "x".repeat(500);
        const result = directorOutputError("截图", new Error(message));
        assert.equal(result, `截图发送到画布失败：${"x".repeat(200)}`);
    });
});
