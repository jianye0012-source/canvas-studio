"use client";

import { useState } from "react";
import { App, Button, Modal } from "antd";

import { deleteCanvasProjects } from "@/services/api/canvas-tasks";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog({ onDeleted }: { onDeleted?: (ids: string[]) => void }) {
    const { message } = App.useApp();
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const [deleting, setDeleting] = useState(false);
    const confirm = async () => {
        if (deleting) return;
        setDeleting(true);
        try {
            await deleteCanvasProjects(ids);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "画布删除失败");
            setDeleting(false);
            return;
        }
        deleteProjects(ids);
        cleanupImages();
        removeSelectedIds(ids);
        setDeleteIds([]);
        setDeleting(false);
        onDeleted?.(ids);
    };

    return (
        <Modal
            title="删除画布？"
            open={ids.length > 0}
            centered
            maskClosable={false}
            onCancel={deleting ? undefined : () => setDeleteIds([])}
            footer={
                <>
                    <Button disabled={deleting} onClick={() => setDeleteIds([])}>取消</Button>
                    <Button danger type="primary" loading={deleting} onClick={confirm}>
                        删除
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">将删除 {ids.length} 个画布，里面的节点和连线也会一起移除。</p>
        </Modal>
    );
}
