import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    createDirectorOutputDedupe,
    directorOutputError,
    isValidDirectorRequestId,
} from "./canvas-director-output";

const uuid = "123e4567-e89b-12d3-a456-426614174000";

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

describe("createDirectorOutputDedupe", () => {
    it("同一编号只处理一次", async () => {
        let calls = 0;
        const dedupe = createDirectorOutputDedupe();
        const first = dedupe.run(uuid, async () => {
            calls++;
            return { ok: true };
        });
        const second = dedupe.run(uuid, async () => {
            calls++;
            return { ok: true };
        });
        const [a, b] = await Promise.all([first, second]);
        assert.equal(calls, 1);
        assert.deepEqual(a, { ok: true });
        assert.deepEqual(b, { ok: true });
    });

    it("不同编号各自处理", async () => {
        let calls = 0;
        const dedupe = createDirectorOutputDedupe();
        const a = dedupe.run("a".repeat(36), async () => {
            calls++;
            return { ok: true };
        });
        const b = dedupe.run(uuid, async () => {
            calls++;
            return { ok: true };
        });
        await Promise.all([a, b]);
        assert.equal(calls, 2);
    });

    it("失败结果也去重但不吞错", async () => {
        let calls = 0;
        const dedupe = createDirectorOutputDedupe();
        const handler = async () => {
            calls++;
            throw new Error("上传失败");
        };
        const a = dedupe.run(uuid, handler);
        const b = dedupe.run(uuid, handler);
        const [ra, rb] = await Promise.all([a, b]);
        assert.equal(calls, 1);
        assert.deepEqual(ra, { ok: false, error: "上传失败" });
        assert.deepEqual(rb, { ok: false, error: "上传失败" });
    });

    it("超过 10 分钟的条目被清理", async () => {
        let now = 0;
        let calls = 0;
        const dedupe = createDirectorOutputDedupe({ now: () => now });
        const handler = async () => {
            calls++;
            return { ok: true };
        };
        await dedupe.run(uuid, handler);
        now = 10 * 60 * 1000 + 1;
        await dedupe.run(uuid, handler);
        assert.equal(calls, 2);
    });

    it("非法编号不去重", async () => {
        assert.equal(isValidDirectorRequestId("x"), false);
        let calls = 0;
        const dedupe = createDirectorOutputDedupe();
        const handler = async () => {
            calls++;
            return { ok: true };
        };
        await dedupe.run("x", handler);
        await dedupe.run("x", handler);
        assert.equal(calls, 2);
    });
});
