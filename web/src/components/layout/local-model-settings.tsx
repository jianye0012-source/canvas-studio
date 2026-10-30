"use client";

import { useEffect, useId, useState } from 'react';
import { localConfig, localRoles, testLocalChannel, type LocalChannel, type LocalModelConfig } from '@/services/api/local';
import { useConfigStore } from '@/stores/use-config-store';

const fieldClass = 'mt-2 block w-full rounded-md border border-current/15 bg-transparent px-3 py-2 text-sm';
const buttonClass = 'rounded-md border border-current/15 px-3 py-2 text-sm disabled:opacity-50';
const capabilityLabels = { text: '文字 / 白模', image: '图片', video: '视频' };
function validSelections(config: LocalModelConfig) {
    const next = { ...config };
    for (const role of localRoles) {
        const channel = config.channels.find(entry => entry.id === config[`${role.key}ChannelId`] && entry.enabled);
        if (!channel?.models.some(model => model === config[`${role.key}Model`] && channel.modelCapabilities[model] === role.capability)) { next[`${role.key}Model`] = ''; next[`${role.key}ChannelId`] = ''; }
    }
    return next;
}

export function LocalModelSettings() {
    const [config, setConfig] = useState<LocalModelConfig>();
    const [activeId, setActiveId] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [testing, setTesting] = useState(false);
    const [catalogues, setCatalogues] = useState<Record<string, string[]>>({});
    const [modelName, setModelName] = useState('');
    const [capability, setCapability] = useState<keyof typeof capabilityLabels>('text');
    const listId = useId();
    const loadSettings = useConfigStore(state => state.loadPublicSettings);
    useEffect(() => { let canceled = false; localConfig().then(value => { if (!canceled) { setConfig(value); setActiveId(value.channels[0]?.id || ''); } }).catch(error => { if (!canceled) setMessage(error.message); }); return () => { canceled = true; }; }, []);
    const active = config?.channels.find(channel => channel.id === activeId);
    const replaceChannels = (channels: LocalChannel[]) => setConfig(current => current && validSelections({ ...current, channels }));
    const updateChannel = (patch: Partial<LocalChannel>) => { if (config) replaceChannels(config.channels.map(channel => channel.id === activeId ? { ...channel, ...patch } : channel)); };
    const addChannel = () => {
        if (!config) return;
        const id = crypto.randomUUID();
        replaceChannels([...config.channels, { id, name: `渠道 ${config.channels.length + 1}`, baseUrl: '', apiKey: '', enabled: true, models: [], modelCapabilities: {} }]);
        setActiveId(id); setModelName('');
    };
    const addModel = () => {
        if (!active) return;
        const id = modelName.trim();
        if (!id) return setMessage('请填写或选择模型名称');
        updateChannel({ models: [...new Set([...active.models, id])], modelCapabilities: { ...active.modelCapabilities, [id]: capability } }); setModelName(''); setMessage('模型已加入，请保存全部配置后使用。');
    };
    return <form className="space-y-6" onSubmit={async event => {
        event.preventDefault(); if (!config) return; setBusy(true);
        try { setConfig(await localConfig(config)); await loadSettings(); setMessage('全部渠道和默认选择已保存。已打开的导演台重新打开后生效。'); }
        catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); } finally { setBusy(false); }
    }}>
        <p className="text-sm opacity-60">每个渠道分别配置 OpenAI 兼容接口和密钥。白模导演需支持工具调用，参考图需支持视觉输入。密钥在本机加密保存。</p>
        {config && <fieldset disabled={busy} className="min-w-0 space-y-6 disabled:opacity-60">
            <section aria-label="渠道管理" className="space-y-4">
                <div className="flex items-center justify-between"><h3 className="font-medium">模型渠道 <span className="text-sm opacity-50">{config.channels.length} 个</span></h3><button type="button" className={buttonClass} onClick={addChannel}>＋ 新增渠道</button></div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="选择配置渠道">{config.channels.map(channel => <button key={channel.id} type="button" aria-pressed={activeId === channel.id} className={`${buttonClass} ${activeId === channel.id ? 'bg-primary/10 text-primary' : ''}`} onClick={() => { setActiveId(channel.id); setModelName(''); }}>{channel.name}{channel.enabled ? '' : ' · 已停用'}</button>)}</div>
                {active ? <div className="space-y-4 rounded-lg border border-current/10 p-4">
                    <div className="flex items-center justify-between"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active.enabled} onChange={event => updateChannel({ enabled: event.target.checked })} />启用此渠道</label><button type="button" className={buttonClass} onClick={() => { replaceChannels(config.channels.filter(channel => channel.id !== activeId)); setActiveId(config.channels.find(channel => channel.id !== activeId)?.id || ''); setMessage('渠道已移除；原项目和素材保留。保存后生效。'); }}>删除渠道</button></div>
                    <label className="block text-sm">渠道名称<input className={fieldClass} value={active.name} onChange={event => updateChannel({ name: event.target.value })} /></label>
                    <label className="block text-sm">接口地址<input type="url" className={fieldClass} value={active.baseUrl} placeholder="https://你的服务地址/v1" onChange={event => updateChannel({ baseUrl: event.target.value })} /></label>
                    <label className="block text-sm">API Key<input type="password" autoComplete="off" className={fieldClass} value={active.apiKey || ''} placeholder={active.hasApiKey ? '已设置，留空保留原密钥' : '接口无需密钥时可留空'} onChange={event => updateChannel({ apiKey: event.target.value, clearApiKey: false })} /></label>
                    {active.keyUnavailable && <p role="alert" className="text-sm">此渠道密钥无法解密，请重新填写或清除。</p>}
                    <div className="flex flex-wrap gap-2"><button type="button" disabled={testing} className={buttonClass} onClick={async () => { setTesting(true); try { const result = await testLocalChannel(active); setCatalogues(current => ({ ...current, [active.id]: result.models })); setMessage(`渠道「${active.name}」连接成功，读取到 ${result.models.length} 个模型。请选择需要的模型并指定类型。`); } catch (error) { setMessage(error instanceof Error ? error.message : '连接失败'); } finally { setTesting(false); } }}>{testing ? '正在连接…' : '测试此渠道 / 读取模型'}</button><button type="button" className={buttonClass} onClick={() => { updateChannel({ apiKey: '', clearApiKey: true, hasApiKey: false }); setMessage('该渠道密钥将于保存时清除。'); }}>清除此渠道密钥</button></div>
                    <div className="border-t border-current/10 pt-4"><p className="mb-2 text-sm opacity-60">加入可选模型；可从接口列表选取，也可手动填写。</p><div className="flex flex-wrap items-end gap-2"><label className="min-w-36 flex-1 text-sm">模型名称<input className={fieldClass} list={listId} value={modelName} onChange={event => setModelName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addModel(); } }} /></label><label className="text-sm">类型<select aria-label="类型" className={fieldClass} value={capability} onChange={event => setCapability(event.target.value as keyof typeof capabilityLabels)}>{Object.entries(capabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" className={buttonClass} onClick={addModel}>加入模型</button></div><datalist id={listId}>{(catalogues[active.id] || []).map(model => <option key={model} value={model} />)}</datalist></div>
                    <ul className="space-y-2" aria-label="此渠道的模型">{active.models.map(model => <li key={model} className="flex items-center gap-3 text-sm"><span className="min-w-0 flex-1 break-all">{model}</span><span className="opacity-60">{capabilityLabels[active.modelCapabilities[model]]}</span><button type="button" aria-label={`移除模型 ${model}`} className={buttonClass} onClick={() => updateChannel({ models: active.models.filter(entry => entry !== model) })}>移除</button></li>)}</ul>
                </div> : <p className="py-4 text-sm opacity-60">还没有渠道，点击“新增渠道”开始配置。</p>}
            </section>
            <section className="space-y-3 border-t border-current/10 pt-5" aria-label="各功能默认模型"><h3 className="font-medium">各功能默认模型</h3><p className="text-sm opacity-60">每项可以选择不同渠道。画布和导演台内仍可切换已配置的模型。</p><div className="grid gap-4 sm:grid-cols-2">{localRoles.map(role => <label key={role.key} className="block text-sm">{role.label}<select aria-label={role.label} className={fieldClass} value={config[`${role.key}Model`] ? JSON.stringify([config[`${role.key}ChannelId`], config[`${role.key}Model`]]) : ''} onChange={event => { const [channelId, model] = event.target.value ? JSON.parse(event.target.value) : ['', '']; setConfig({ ...config, [`${role.key}ChannelId`]: channelId, [`${role.key}Model`]: model }); }}><option value="">暂不设置</option>{config.channels.filter(channel => channel.enabled).map(channel => <optgroup key={channel.id} label={channel.name}>{channel.models.filter(model => channel.modelCapabilities[model] === role.capability).map(model => <option key={model} value={JSON.stringify([channel.id, model])}>{channel.name} · {model}</option>)}</optgroup>)}</select></label>)}</div></section>
            <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? '保存中…' : '保存全部配置'}</button>
        </fieldset>}
        {message && <p role="status" className="text-sm">{message}</p>}
    </form>;
}
