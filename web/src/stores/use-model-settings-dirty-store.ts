"use client";
import { create } from "zustand";
export const useModelSettingsDirtyStore = create<{ dirty: boolean; setDirty: (dirty: boolean) => void }>((set) => ({ dirty: false, setDirty: (dirty) => set({ dirty }) }));
