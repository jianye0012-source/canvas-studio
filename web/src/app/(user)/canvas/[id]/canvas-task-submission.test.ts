import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hasPendingSubmission } from "./canvas-task-submission";

describe("hasPendingSubmission", () => {
    it("submission 未结束时返回 true", () => {
        assert.equal(hasPendingSubmission({ submission: Promise.resolve() }), true);
    });

    it("没有 submission 时返回 false", () => {
        assert.equal(hasPendingSubmission({}), false);
    });

    it("没有 run 时返回 false", () => {
        assert.equal(hasPendingSubmission(undefined), false);
    });
});
