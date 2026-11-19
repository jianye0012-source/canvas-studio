"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LocalModelSettings } from "@/components/layout/local-model-settings";
import { useLeaveModelSettings } from "@/hooks/use-leave-model-settings";
export default function LocalSettingsPage() {
    const router = useRouter();
    const leave = useLeaveModelSettings();
    return <main className="mx-auto w-full max-w-2xl p-8"><Link href="/canvas" className="text-sm opacity-60" onClick={event => { event.preventDefault(); leave(() => router.push("/canvas")); }}>← 返回画布</Link><h1 className="my-6 text-2xl">模型配置</h1><LocalModelSettings /></main>;
}
