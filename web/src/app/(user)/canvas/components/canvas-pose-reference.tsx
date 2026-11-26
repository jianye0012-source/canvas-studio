"use client";

import { useState } from "react";
import { Button, Modal, Tooltip } from "antd";
import { PersonStanding } from "lucide-react";

import { PoseGalleryBrowser } from "@/components/pose-gallery/pose-gallery-browser";
import { canvasThemes } from "@/lib/canvas-theme";
import { poseViewPrompt } from "@/services/api/pose-gallery";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasPoseReference({ onSelect }: { onSelect: (image: { url: string; title: string }, prompt: string) => void }) {
    const [open, setOpen] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <Tooltip title="姿势 / 服装 / 人像参考">
                <Button
                    type="text"
                    className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0"
                    style={{ color: theme.node.text }}
                    icon={<PersonStanding className="size-3.5" />}
                    onClick={() => setOpen(true)}
                    aria-label="参考图库"
                />
            </Tooltip>
            <Modal title="参考图库" open={open} onCancel={() => setOpen(false)} footer={null} width={900} destroyOnHidden>
                <PoseGalleryBrowser
                    pageSize={8}
                    columns="grid-cols-4"
                    actionLabel="设为参考"
                    onPick={({ item, view, url }) => {
                        onSelect({ url, title: `${item.name}${item.views.length > 1 ? `・${view.angle}` : ""}` }, poseViewPrompt(item, view));
                        setOpen(false);
                    }}
                />
            </Modal>
        </>
    );
}
