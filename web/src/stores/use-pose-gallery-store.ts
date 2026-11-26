import { create } from "zustand";
import { persist } from "zustand/middleware";

type PoseGalleryStore = {
    showSensitive: boolean;
    setShowSensitive: (showSensitive: boolean) => void;
};

export const usePoseGalleryStore = create<PoseGalleryStore>()(
    persist(
        (set) => ({
            showSensitive: false,
            setShowSensitive: (showSensitive) => set({ showSensitive }),
        }),
        { name: "infinite-canvas:pose_gallery_store" },
    ),
);
