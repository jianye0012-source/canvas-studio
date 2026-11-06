import { createCanvasImageTask, pollCanvasImageTaskStatus } from "@/services/api/image";
import { imageToDataUrl } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export async function generateDirectorImage(config: AiConfig, input: Record<string, unknown>, nodeId: string, requestId: string, signal: AbortSignal) {
    const model = config.imageModel;
    if (!model) throw new Error("请先在启动器的模型配置中选择支持参考图的图片模型");
    if (typeof input.prompt !== "string" || !input.prompt.trim()) throw new Error("请输入图片生成指令");
    const urls = [input.imageDataUrl, input.referenceDataUrl, ...(Array.isArray(input.references) ? input.references.map(item => item?.dataUrl) : [])];
    const references: ReferenceImage[] = [...new Set(urls.filter((value): value is string => typeof value === "string" && value.startsWith("data:image/")))].map((dataUrl, index) => ({ id: String(index), name: `导演台参考图${index + 1}`, type: "image/png", dataUrl }));
    if (!references.length) throw new Error("导演台没有提供有效参考图");
    const selected = { ...config, model, activeChannelId: config.imageChannelId, count: "1", ...(typeof input.size === "string" ? { size: input.size } : {}) };
    let task = await createCanvasImageTask(selected, input.prompt, references, { nodeId, source: "canvas", clientTaskId: `director-${requestId}`, signal });
    const deadline = Date.now() + 10 * 60 * 1000;
    while (!["completed", "complete", "done", "succeeded", "success"].includes(task.status.toLowerCase())) {
        signal.throwIfAborted();
        if (["failed", "error", "cancelled", "canceled", "stopped"].includes(task.status.toLowerCase())) throw new Error(task.error?.message || task.error_detail || "导演台图片生成失败");
        if (Date.now() >= deadline) throw new Error(`图片任务等待超时，任务编号 ${task.id}。请先核对任务记录，再决定是否重新提交`);
        await new Promise<void>((resolve, reject) => {
            const cancel = () => { clearTimeout(timer); reject(signal.reason); };
            const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, 1500);
            signal.addEventListener("abort", cancel, { once: true });
        });
        task = await pollCanvasImageTaskStatus(task.id, signal);
    }
    signal.throwIfAborted();
    const url = task.image_url || task.image_urls?.[0] || task.url;
    if (!url) throw new Error("图片任务成功但没有返回有效图片");
    const dataUrl = await imageToDataUrl({ dataUrl: url, storageKey: task.storageKey });
    signal.throwIfAborted();
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("生成图片无法解码")); image.src = dataUrl; });
    return { dataUrl, width: image.naturalWidth, height: image.naturalHeight };
}
