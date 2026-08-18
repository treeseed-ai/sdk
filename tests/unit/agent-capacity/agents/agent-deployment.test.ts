import { describe,expect,it } from 'vitest';
import { planAgentDeployment } from '../../../../src/agent-capacity/authoring/agent-deployment.ts';

const sourceRef='a'.repeat(40);const targetRef='b'.repeat(40);
const entities=[
	{kind:'agent' as const,id:'agent:writer',path:'src/content/agents/writer.mdx',source:'---\nid: agent:writer\nenabled: true\ngroupIds: [group:editorial]\n---\nWriter',digest:'writer',references:['group:editorial','query:guide'],groupIds:['group:editorial'],enabled:true},
	{kind:'agent' as const,id:'agent:unrelated',path:'src/content/agents/unrelated.mdx',source:'---\nid: agent:unrelated\nenabled: true\ngroupIds: [group:other]\n---\nOther',digest:'other',references:['group:other'],groupIds:['group:other'],enabled:true},
	{kind:'group' as const,id:'group:editorial',path:'src/content/groups/editorial.mdx',source:'---\nid: group:editorial\n---\nEditorial',digest:'group',references:[]},
	{kind:'context-query' as const,id:'query:guide',path:'src/content/agent-context-queries/guide.mdx',source:'---\nid: query:guide\n---\nGuide query',digest:'query',references:[]},
];
const bindings={targetProjectId:'project:target',targetContentRoot:'src/content'};

describe('governed agent deployment',()=>{
	it('copies only effective members and their reachable closure as dormant forks',()=>{const plan=planAgentDeployment({selector:{sourceTeamId:'team',sourceProjectId:'market',sourceRepositoryId:'repo',sourceRef,groupId:'group:editorial'},bindings,entities,targetBaseRef:targetRef,generation:'generation'});expect(plan.ok).toBe(true);expect(plan.selectedAgentIds).toEqual(['agent:writer']);expect(plan.entities.map((entry)=>entry.id)).toEqual(['query:guide','agent:writer','group:editorial']);expect(plan.entities.find((entry)=>entry.id==='agent:writer')?.source).toContain('enabled: false');expect(plan.entities.some((entry)=>entry.id==='agent:unrelated')).toBe(false);});
	it('fails closed on unresolved bindings and unrelated target collisions',()=>{const scoped=[...entities,{kind:'discussion-topic' as const,id:'topic:project',path:'src/content/discussion-topics/project.mdx',source:'topic',digest:'topic',references:['book:source-guide']}];const withTopic={...scoped[0]!,references:['group:editorial','query:guide','topic:project']};const plan=planAgentDeployment({selector:{sourceTeamId:'team',sourceProjectId:'market',sourceRepositoryId:'repo',sourceRef,agentId:'agent:writer'},bindings,entities:[withTopic,...scoped.slice(1)],targetBaseRef:targetRef,generation:'generation',targetEntities:[{...withTopic,path:'src/content/agents/writer.mdx',digest:'local-divergence'}]});expect(plan.ok).toBe(false);expect(plan.unresolvedBindings).toContain('topic:project:book:source-guide');expect(plan.conflicts).toContain('src/content/agents/writer.mdx');});
});
