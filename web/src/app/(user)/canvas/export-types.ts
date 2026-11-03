import type { CanvasProject } from "./stores/use-canvas-store";

export type CanvasExportFile = {
    app: "infinite-canvas";
    version: 3 | 4;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
};

export type CanvasProjectExportItem = {
    project: CanvasProject;
    files: CanvasExportAsset[];
    directors?: { nodeId: string; path: string }[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
    sources?: string[];
};
