"use client";
import { App } from "antd";
import { useModelSettingsDirtyStore } from "@/stores/use-model-settings-dirty-store";
export const leaveModelSettingsText = "模型配置有未保存的改动，离开后不会生效。确定离开吗？";
// 没有未保存改动直接离开；有则弹确认，确认后才离开。
export function useLeaveModelSettings() {
    const { modal } = App.useApp();
    return (leave: () => void) => {
        if (!useModelSettingsDirtyStore.getState().dirty) return leave();
        modal.confirm({ title: "离开模型配置", content: leaveModelSettingsText, okText: "离开", cancelText: "取消", zIndex: 6000, onOk: leave });
    };
}
