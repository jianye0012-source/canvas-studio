import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { configStoppableChildren } from "./canvas-config-stop";

describe("configStoppableChildren", () => {
    it("只返回本配置节点的生成中子节点", () => {
        const result = configStoppableChildren(
            "A",
            [
                { id: "a1", metadata: { status: "loading", clientTaskId: "task-1" } },
                { id: "a2", metadata: { status: "success", clientTaskId: "task-2" } },
                { id: "a3", metadata: { status: "loading" } },
                { id: "b1", metadata: { status: "loading", clientTaskId: "task-3" } },
            ],
            [
                { fromNodeId: "A", toNodeId: "a1" },
                { fromNodeId: "A", toNodeId: "a2" },
                { fromNodeId: "A", toNodeId: "a3" },
                { fromNodeId: "B", toNodeId: "b1" },
            ],
        );
        assert.deepEqual(result, ["a1"]);
    });

    it("batch root 不返回", () => {
        const result = configStoppableChildren(
            "A",
            [{ id: "a1", metadata: { status: "loading", clientTaskId: "task-1", isBatchRoot: true } }],
            [{ fromNodeId: "A", toNodeId: "a1" }],
        );
        assert.deepEqual(result, []);
    });

    it("stopping 状态返回", () => {
        const result = configStoppableChildren(
            "A",
            [{ id: "a1", metadata: { status: "stopping", clientTaskId: "task-1" } }],
            [{ fromNodeId: "A", toNodeId: "a1" }],
        );
        assert.deepEqual(result, ["a1"]);
    });
});
