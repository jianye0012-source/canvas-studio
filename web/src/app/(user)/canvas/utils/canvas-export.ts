import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { getMediaBlob, resolveMediaUrl, uploadMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasExportAsset, CanvasExportFile } from "../export-types";
import { persistCanvasProjectNow, useCanvasStore, type CanvasProject } from "../stores/use-canvas-store";
import { CanvasNodeType } from "../types";

type FileReference = { key: string; sources: Set<string> };
const localFilePattern = /^(?:https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)?(\/api\/files\/([\w-]+)\/content)(?:[?#].*)?$/;
const mediaFields = new Set(["url", "content", "dataUrl", "src", "videoUrl", "audioUrl", "imageUrl", "thumbnailUrl", "previewUrl"]);
const mediaNodeTypes = new Set([CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Panorama]);

function collectReferences(value: unknown, refs: Map<string, FileReference>) {
    if (Array.isArray(value)) { value.forEach(item => collectReferences(item, refs)); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const storageKey = typeof record.storageKey === "string" && record.storageKey.includes(":") ? record.storageKey : "";
    if (storageKey && !refs.has(storageKey)) refs.set(storageKey, { key: storageKey, sources: new Set() });
    for (const [field, item] of Object.entries(record)) {
        const local = typeof item === "string" ? item.match(localFilePattern) : null;
        const media = typeof item === "string" && mediaFields.has(field) && /^(https?:|blob:|\/api\/files\/)/.test(item);
        if (local) {
            const key = "server:" + local[2];
            const ref = refs.get(key) || { key, sources: new Set<string>() };
            ref.sources.add(local[1]); ref.sources.add(item as string); refs.set(key, ref);
        } else if (storageKey && media && typeof item === "string") {
            refs.get(storageKey)!.sources.add(item);
        } else collectReferences(item, refs);
    }
}

async function readReference(ref: FileReference) {
    const { key } = ref;
    const cached = key.startsWith("image:") ? await getImageBlob(key) : await getMediaBlob(key);
    if (cached?.size) return cached;
    const localId = key.match(/^server:([\w-]+)$/)?.[1];
    const url = localId ? "/api/files/" + encodeURIComponent(localId) + "/content" : await resolveMediaUrl(key, [...ref.sources][0] || "");
    if (url) {
        const response = await fetch(url);
        if (response.ok) {
            const blob = await response.blob();
            if (blob.size && blob.type !== "application/json" && blob.type !== "text/html") return blob;
        }
    }
    throw new Error("找不到素材 " + (localId || key));
}

export async function exportCanvasProjects(projects: CanvasProject[], fileName = "无限画布") {
    const local = useUserStore.getState().user?.id === "local-owner";
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const exportedProjects: CanvasExportFile["projects"] = [];
    const missing: string[] = [];
    for (const project of projects) {
        const files: CanvasExportAsset[] = [];
        const directors: NonNullable<CanvasExportFile["projects"][number]["directors"]> = [];
        const refs = new Map<string, FileReference>();
        collectReferences(project, refs);
        for (const node of project.nodes) {
            const content = node.metadata?.content;
            if (local && mediaNodeTypes.has(node.type) && !node.metadata?.storageKey && typeof content === "string" && /^(https?:|blob:)/.test(content) && !localFilePattern.test(content)) {
                refs.set(content, { key: content, sources: new Set([content]) });
            }
            if (!local || node.type !== CanvasNodeType.Director) continue;
            const pointer = node.metadata?.directorProject as { projectId?: string } | undefined;
            const response = await fetch("/local/director/" + encodeURIComponent(pointer?.projectId || node.id));
            if (response.status === 404 && !pointer?.projectId) continue;
            if (!response.ok) { missing.push(`${project.title} / 导演台「${node.title}」`); continue; }
            const scene = await response.json();
            collectReferences(scene, refs);
            const path = `projects/${project.id}/director/${directors.length}.json`;
            directors.push({ nodeId: node.id, path });
            zipFiles.push({ name: path, data: JSON.stringify(scene) });
        }
        for (const ref of refs.values()) {
            try {
                const blob = await readReference(ref);
                const path = `projects/${project.id}/files/${files.length}.${fileExtension(blob.type, ref.key)}`;
                files.push({ storageKey: ref.key, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size, sources: [...ref.sources] });
                zipFiles.push({ name: path, data: blob });
            } catch { missing.push(`${project.title} / ${ref.key.slice(0, 120)}`); }
        }
        exportedProjects.push({ project, files, directors });
    }
    if (missing.length) throw new Error(`导出已停止，找不到 ${missing.length} 项内容：${missing.slice(0, 6).join("、")}`);
    const data: CanvasExportFile = { app: "infinite-canvas", version: local ? 4 : 3, exportedAt: new Date().toISOString(), projects: exportedProjects };
    const zip = await createZip([{ name: "projects.json", data: JSON.stringify(data) }, ...zipFiles]);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

export async function importCanvasArchive(file: File) {
    const zip = await readZip(file);
    const manifest = zip.get("projects.json");
    if (!manifest) throw new Error("压缩包中缺少画布清单");
    const data = JSON.parse(await manifest.text()) as CanvasExportFile;
    if (data.app !== "infinite-canvas" || ![3, 4].includes(data.version) || !Array.isArray(data.projects)) throw new Error("画布压缩包格式无效");
    const local = useUserStore.getState().user?.id === "local-owner";
    if (data.version === 4 && !local) throw new Error("请从画布工作台启动器打开后导入");
    for (const item of data.projects) {
        if (!Array.isArray(item.project?.nodes) || !Array.isArray(item.project?.connections) || !Array.isArray(item.files)) throw new Error("画布清单内容无效");
        for (const asset of item.files) if (zip.get(asset.path)?.size !== asset.bytes) throw new Error(`导入包缺少或损坏素材 ${asset.path}`);
        for (const director of item.directors || []) if (!zip.has(director.path) || !item.project.nodes.some(node => node.id === director.nodeId && node.type === CanvasNodeType.Director)) throw new Error(`导演台文件无效 ${director.path}`);
    }
    for (const item of data.projects) {
        const replacements = new Map<string, string>();
        const uploadedByKey = new Map<string, { storageKey: string; url: string }>();
        const scenes: string[] = [];
        let committed = false;
        try {
            for (const asset of item.files) {
                const entry = zip.get(asset.path)!;
                const blob = entry.slice(0, entry.size, asset.mimeType);
                if (!local) {
                    const write = asset.storageKey.startsWith("image:") ? (await import("@/services/image-storage")).setImageBlob : (await import("@/services/file-storage")).setMediaBlob;
                    await write(asset.storageKey, blob);
                    continue;
                }
                const uploaded = await uploadMediaBlob(blob, asset.path.split("/").at(-1)!);
                uploadedByKey.set(asset.storageKey, uploaded);
                for (const source of asset.sources || []) replacements.set(source, uploaded.url);
                const oldId = asset.storageKey.match(/^server:([\w-]+)$/)?.[1];
                if (oldId) replacements.set(`/api/files/${oldId}/content`, uploaded.url);
            }
            const rewrite = (value: unknown): unknown => {
                if (typeof value === "string") return replacements.get(value) || replacements.get(value.match(localFilePattern)?.[1] || "") || value;
                if (Array.isArray(value)) return value.map(rewrite);
                if (!value || typeof value !== "object") return value;
                const record = value as Record<string, unknown>;
                const uploaded = typeof record.storageKey === "string" ? uploadedByKey.get(record.storageKey) : undefined;
                return Object.fromEntries(Object.entries(record).map(([field, child]) => [
                    field, uploaded && field === "storageKey" ? uploaded.storageKey :
                        uploaded && mediaFields.has(field) && typeof child === "string" && /^(https?:|blob:|\/api\/files\/)/.test(child) ? uploaded.url : rewrite(child),
                ]));
            };
            const project = rewrite(item.project) as CanvasProject;
            for (const director of item.directors || []) {
                const node = project.nodes.find(entry => entry.id === director.nodeId)!;
                const scene = rewrite(JSON.parse(await zip.get(director.path)!.text()));
                const id = crypto.randomUUID();
                const response = await fetch(`/local/director/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(scene) });
                if (!response.ok) throw new Error(`导演台「${node.title}」未能写入本机磁盘`);
                scenes.push(id);
                node.metadata = { ...node.metadata, directorProject: { engine: "cozyclay", schemaVersion: 1, projectId: id } };
            }
            if (local) for (const node of project.nodes) {
                if (node.metadata?.folderLoop) node.metadata = { ...node.metadata, folderLoop: undefined };
                if (node.metadata?.status === "loading" || node.metadata?.status === "stopping") {
                    node.metadata = { ...node.metadata, status: "error", errorDetails: "此项目来自导入包，原电脑的生成任务不会继续执行", imageTaskId: undefined, videoTaskId: undefined, audioTaskId: undefined };
                }
            }
            const id = useCanvasStore.getState().importProject(project);
            committed = true;
            if (local) await persistCanvasProjectNow(id, project.nodes, project.connections);
        } finally {
            if (!committed) await Promise.allSettled([
                ...[...uploadedByKey.values()].map(({ storageKey }) => fetch(`/api/v1/files/${encodeURIComponent(storageKey.slice(7))}`, { method: "DELETE" })),
                ...scenes.map(id => fetch(`/local/director/${id}`, { method: "DELETE" })),
            ]);
        }
    }
    return data.projects.length;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return storageKey.startsWith("image:") ? "png" : "bin";
}
