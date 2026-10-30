"use client";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { LocalModelSettings } from "./local-model-settings";
export function AppConfigModal() {
    const open = useConfigStore((state) => state.isConfigOpen);
    const close = useConfigStore((state) => state.setConfigDialogOpen);
    const theme = useThemeStore((state) => state.theme);
    if (!open) return null;
    return <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/30 p-6" onClick={() => close(false)}>
        <section role="dialog" aria-modal="true" aria-label="模型配置" className="max-h-full w-full max-w-lg overflow-auto rounded-xl p-6 shadow-xl" style={{ background: canvasThemes[theme].node.panel, color: canvasThemes[theme].node.text }} onClick={(event) => event.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between"><h2 className="text-lg">模型配置</h2><button onClick={() => close(false)} aria-label="关闭配置">✕</button></div><LocalModelSettings />
        </section>
    </div>;
}
