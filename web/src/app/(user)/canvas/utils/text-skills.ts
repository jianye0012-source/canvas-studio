import { invalidateAgentSkillCache, useAgentSkillStore } from '@/stores/use-agent-skill-store';
import type { CanvasAgentSkillSelection } from '../types';
export async function textSkillInstructions(selected: CanvasAgentSkillSelection[] = []) {
    if (!selected.length) return '';
    invalidateAgentSkillCache(); await useAgentSkillStore.getState().loadSkills();
    const { systemSkills, userSkills } = useAgentSkillStore.getState();
    return selected.map(selection => {
        const skill = [...systemSkills, ...userSkills].find(s => s.id === selection.id && s.source === selection.source && s.enabled);
        if (!skill) throw new Error(`Skill「${selection.name}」已删除或停用，请重新选择`);
        return `## Skill：${skill.name}\n${skill.content}`;
    }).join('\n\n');
}
