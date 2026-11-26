"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Empty, Input, Pagination, Segmented, Select, Spin, Switch, Tag } from "antd";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { fetchPoseGallery, poseFileUrl, type PoseRefItem, type PoseRefKind, type PoseRefView } from "@/services/api/pose-gallery";
import { usePoseGalleryStore } from "@/stores/use-pose-gallery-store";

export type PoseGalleryPick = { item: PoseRefItem; view: PoseRefView; url: string };

const KIND_OPTIONS: { label: string; value: PoseRefKind }[] = [
    { label: "姿势", value: "pose" },
    { label: "服装", value: "costume" },
    { label: "人像", value: "portrait" },
];

export function PoseGalleryBrowser({ pageSize = 12, columns = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4", actionLabel = "查看", onPick }: { pageSize?: number; columns?: string; actionLabel?: string; onPick: (pick: PoseGalleryPick) => void }) {
    const showSensitive = usePoseGalleryStore((state) => state.showSensitive);
    const setShowSensitive = usePoseGalleryStore((state) => state.setShowSensitive);
    const [kind, setKind] = useState<PoseRefKind>("pose");
    const [group, setGroup] = useState("");
    const [category, setCategory] = useState("");
    const [angle, setAngle] = useState("");
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);

    const query = useQuery({
        queryKey: ["pose-gallery", kind, group, category, angle, keyword, showSensitive, page, pageSize],
        queryFn: () => fetchPoseGallery({ kind, group, category, angle, keyword, safe: showSensitive ? "0" : "1", page, pageSize }),
        placeholderData: (previous) => previous,
        retry: false,
    });

    useEffect(() => setPage(1), [kind, group, category, angle, keyword, showSensitive]);

    const data = query.data;
    const filterSelect = (label: string, value: string, options: string[] | undefined, onChange: (value: string) => void) => (
        <Select size="small" className="min-w-28" value={value} onChange={onChange} options={[{ label: `全部${label}`, value: "" }, ...(options || []).map((item) => ({ label: item, value: item }))]} />
    );

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <Segmented
                    size="small"
                    value={kind}
                    options={KIND_OPTIONS}
                    onChange={(value) => {
                        setKind(value as PoseRefKind);
                        setGroup("");
                        setCategory("");
                        setAngle("");
                    }}
                />
                {filterSelect(kind === "portrait" ? "分区" : kind === "pose" ? "体系" : "来源", group, data?.groups, (value) => {
                    setGroup(value);
                    setCategory("");
                })}
                {filterSelect(kind === "portrait" ? "发长" : "分类", category, data?.categories, setCategory)}
                {kind !== "portrait" ? filterSelect("角度", angle, data?.angles, setAngle) : null}
                <Input size="small" className="!w-44" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder="搜索名称、标签" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                {kind !== "portrait" ? (
                    <label className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                        <Switch size="small" checked={showSensitive} onChange={setShowSensitive} />
                        NSFW
                    </label>
                ) : null}
            </div>

            {query.isLoading ? (
                <div className="flex justify-center py-16">
                    <Spin />
                </div>
            ) : query.isError ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query.error instanceof Error ? query.error.message : "参考图库加载失败"} className="py-12" />
            ) : data?.items.length ? (
                <div className={cn("grid gap-3", columns)}>
                    {data.items.map((item) => (
                        <PoseCard key={item.id} item={item} actionLabel={actionLabel} onPick={onPick} />
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到参考图" className="py-12" />
            )}

            {(data?.total || 0) > pageSize ? (
                <div className="flex justify-center">
                    <Pagination size="small" current={page} pageSize={pageSize} total={data?.total || 0} showSizeChanger={false} onChange={setPage} />
                </div>
            ) : null}
        </div>
    );
}

function PoseCard({ item, actionLabel, onPick }: { item: PoseRefItem; actionLabel: string; onPick: (pick: PoseGalleryPick) => void }) {
    const [viewIndex, setViewIndex] = useState(0);
    const [depth, setDepth] = useState(false);
    const view = item.views[viewIndex] || item.views[0];
    const useDepth = depth && Boolean(view?.depthUrl);
    const cover = poseFileUrl(useDepth ? view?.depthUrl : view?.coverUrl);

    useEffect(() => setViewIndex(0), [item]);

    if (!view) return null;
    return (
        <div className="group overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
            <button type="button" className="relative block w-full" onClick={() => onPick({ item, view, url: poseFileUrl(useDepth ? view.depthUrl : view.url) })}>
                <img src={cover} alt={item.name} loading="lazy" className="aspect-[3/4] w-full bg-stone-100 object-contain dark:bg-stone-800" />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/50 group-hover:opacity-100">{actionLabel}</span>
            </button>
            <div className="space-y-1.5 p-2">
                <div className="line-clamp-1 text-xs font-medium text-stone-800 dark:text-stone-200" title={item.name}>
                    {item.name}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                    <Tag className="m-0 text-[10px]">{item.category}</Tag>
                    {item.views.length > 1
                        ? item.views.map((option, index) => (
                              <Tag.CheckableTag key={option.angle} checked={index === viewIndex} className={cn("prompt-filter-tag !m-0 !px-1.5 !text-[10px]", index === viewIndex && "is-active")} onChange={() => setViewIndex(index)}>
                                  {option.angle}
                              </Tag.CheckableTag>
                          ))
                        : null}
                    {view.depthUrl ? (
                        <Tag.CheckableTag checked={depth} className={cn("prompt-filter-tag !m-0 !px-1.5 !text-[10px]", depth && "is-active")} onChange={setDepth}>
                            深度图
                        </Tag.CheckableTag>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
