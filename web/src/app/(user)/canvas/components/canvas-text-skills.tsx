import { CanvasAgentSkillPopover } from './canvas-agent-skill-popover';
import { MAX_CANVAS_AGENT_SKILLS, type CanvasNodeData, type CanvasNodeMetadata } from '../types';
export function CanvasTextSkills({ node, onChange }: { node: CanvasNodeData; onChange: (id: string, patch: Partial<CanvasNodeMetadata>) => void }) {
    const skills = node.metadata?.textSkills || [];
    return <div className="flex min-w-0 items-center gap-2"><CanvasAgentSkillPopover selectedSkills={skills} onSelect={skill => { const next = skills.filter(s => s.id !== skill.id || s.source !== skill.source); if (next.length < MAX_CANVAS_AGENT_SKILLS) onChange(node.id, { textSkills: [...next, skill] }); }} onDeleteSelected={(id, source) => onChange(node.id, { textSkills: skills.filter(s => s.id !== id || s.source !== source) })} /><span className="max-w-40 truncate text-[11px] opacity-70" title={skills.map(s => s.name).join('、')}>{skills.length ? skills.map(s => s.name).join('、') : '可为文字生成选择 Skill'}</span></div>;
}
