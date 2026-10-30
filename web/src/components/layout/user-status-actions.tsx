"use client";

import { Keyboard, Settings2, Shield } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type Props = { showConfig?: boolean; variant?: "default" | "canvas"; onOpenShortcuts?: () => void; accountOpen?: boolean; onAccountOpenChange?: (open: boolean) => void; accountRef?: RefObject<HTMLDivElement | null>; getPopupContainer?: (node: HTMLElement) => HTMLElement };
export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts }: Props) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const style = variant === "canvas" ? { color: canvasThemes[theme].node.text } : undefined;
    const className = "inline-flex size-7 shrink-0 items-center justify-center opacity-70 transition hover:opacity-100 [&_svg]:size-4";
    return <div className="inline-flex shrink-0 items-center gap-1" style={style}>
        {showConfig && <button className={className} onClick={() => openConfigDialog(false)} title="模型配置" aria-label="模型配置"><Settings2 /></button>}
        <Link className={className} href="/admin/assets" title="素材与管理" aria-label="素材与管理"><Shield /></Link>
        {onOpenShortcuts && <button className={className} onClick={onOpenShortcuts} title="快捷键" aria-label="快捷键"><Keyboard /></button>}
        <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={className} aria-label="切换主题" />
    </div>;
}
