import { apiGet, compactApiParams } from "@/services/api/request";

export type PoseRefKind = "pose" | "costume" | "portrait";

export type PoseRefView = {
    angle: string;
    url: string;
    coverUrl: string;
    depthUrl?: string;
};

export type PoseRefItem = {
    id: string;
    kind: PoseRefKind;
    group: string;
    category: string;
    name: string;
    tags: string[] | null;
    prompt: string;
    promptEn: string;
    views: PoseRefView[];
    width?: number;
    height?: number;
    sensitive: boolean;
};

export type PoseRefResponse = {
    items: PoseRefItem[];
    groups: string[];
    categories: string[];
    angles: string[];
    total: number;
};

export type PoseRefQuery = {
    kind: PoseRefKind;
    group?: string;
    category?: string;
    angle?: string;
    keyword?: string;
    safe?: "0" | "1";
    page?: number;
    pageSize?: number;
};

export async function fetchPoseGallery(query: PoseRefQuery) {
    return apiGet<PoseRefResponse>("/api/pose-gallery", compactApiParams(query));
}

export function poseFileUrl(path?: string) {
    return path ? `/api/pose-gallery/files/${path}` : "";
}

export function poseViewPrompt(item: PoseRefItem, view?: PoseRefView) {
    return item.kind === "pose" && view?.angle ? `${view.angle}视角，${item.prompt}` : item.prompt;
}
