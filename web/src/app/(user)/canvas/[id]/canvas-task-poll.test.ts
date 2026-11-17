import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { taskPollFailure } from "./canvas-task-poll";

describe("taskPollFailure", () => {
    it("任务不存在立即失败", () => {
        const result = taskPollFailure(0, new Error("图片任务不存在"));
        assert.equal(result.count, 1);
        assert.equal(result.failMessage, "图片任务不存在");
        assert.equal(result.warnMessage, undefined);
    });

    it("连续 6 次失败后显示原因", () => {
        let count = 0;
        for (let index = 0; index < 5; index++) {
            const result = taskPollFailure(count, new Error("Network Error"));
            assert.equal(result.failMessage, undefined);
            assert.equal(result.warnMessage, undefined);
            count = result.count;
        }
        const warned = taskPollFailure(count, new Error("Network Error"));
        assert.equal(warned.count, 6);
        assert.equal(warned.warnMessage, "无法读取任务状态，正在重试：Network Error");
        const next = taskPollFailure(warned.count, new Error("Network Error"));
        assert.equal(next.count, 7);
        assert.equal(next.warnMessage, undefined);
    });

    it("中止不计数", () => {
        const result = taskPollFailure(4, new DOMException("aborted", "AbortError"));
        assert.equal(result.count, 4);
        assert.equal(result.failMessage, undefined);
        assert.equal(result.warnMessage, undefined);
    });
});
