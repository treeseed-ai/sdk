import { describe,expect,it } from 'vitest';
import { compileAgentDefinition } from '../../../src/agent-capacity/authoring/agent-definition-authoring.ts';
import { validateAgentDefinitionModel } from '../../../src/agent-capacity/validation/agent-definition-schema.ts';

function intent() {
	return {
		name: 'Planning Architect', description: 'Creates decision-ready proposals.', purpose: 'Plan governed work.',
		responsibilities: ['Inspect evidence'], durableInstructions: 'Preserve human decision authority.',
		agentClass: 'architecture', enabled: true,
		activityProfiles: {
			planning: {
				activityType: 'planning' as const, enabled: true, handler: 'writer' as const,
				prompt: { system: 'Inspect the project and propose the next step.' },
				branchPolicy: { kind: 'staging-content' as const, base: 'staging' as const },
				tools: { allowed: ['treeseed.content.create'] },
				outputs: { messageTypes: [], modelMutations: ['proposal:create'] },
			},
		},
	};
}

describe('agent definition Zod validation', () => {
	it('accepts the exact frontmatter emitted by the SDK compiler', () => {
		const compiled = compileAgentDefinition({ intent: intent(), projectId: 'project-1' });
		expect(validateAgentDefinitionModel(compiled.frontmatter)).toMatchObject({ ok: true, diagnostics: [] });
		expect(compiled.frontmatter).not.toHaveProperty('primaryGroupId');
	});

	it('requires explicit groups and rejects removed permission paths',() => {
		const compiled = compileAgentDefinition({ intent:intent(),projectId:'project-1' });
		const value = structuredClone(compiled.frontmatter) as Record<string,any>;
		value.groupIds = [];
		expect(validateAgentDefinitionModel(value)).toMatchObject({ ok:false,diagnostics:expect.arrayContaining([expect.objectContaining({ path:'groupIds' })]) });
		value.groupIds = ['group:project'];
		value.primaryGroupId = 'group:project';
		expect(validateAgentDefinitionModel(value)).toMatchObject({ ok:false,diagnostics:expect.arrayContaining([expect.objectContaining({ path:'primaryGroupId' })]) });
		delete value.primaryGroupId;
		value.activityProfiles.planning.contentAccess = { read:{ models:['note'] } };
		expect(validateAgentDefinitionModel(value)).toMatchObject({ ok:false,diagnostics:expect.arrayContaining([
			expect.objectContaining({ path:'activityProfiles.planning.contentAccess' }),
		]) });
	});

	it('refuses to silently carry or discard removed fields when revising an agent', () => {
		const compiled = compileAgentDefinition({ intent: intent(), projectId: 'project-1' });
		expect(() => compileAgentDefinition({
			intent: intent(), projectId: 'project-1',
			existing: { identity: compiled.identity, frontmatter: { ...compiled.frontmatter, primaryGroupId: 'group:project' } },
		})).toThrow(/removed field primaryGroupId/u);
	});

	it('accepts common and profile relation, permission, trigger, closeout, and narrowing provider contracts',() => {
		const compiled = compileAgentDefinition({ intent:{ ...intent(),contextQueryRefs:[{id:'query:common',revision:1}],contextQuerySetRefs:[{id:'set:common',revision:2}],instructionTemplateRefs:[{id:'template:common',revision:1}] },projectId:'project-1' });
		const planning = (compiled.frontmatter.activityProfiles as Record<string,any>).planning;
		Object.assign(planning,{ contextQueryRefs:[{id:'query:planning',revision:1}],contextQuerySetRefs:[{id:'set:planning',revision:1}],instructionTemplateRefs:[{id:'template:planning',revision:1}],permissions:{ content:{ note:{ operations:['read'],filters:{ status:'live' } } },network:{ allowWeb:false } },artifactTriggers:[{ event:'assignment.completed',artifactKind:'assignment_summary',required:true }],closeoutPolicy:{ warningSeconds:120,summaryRequired:true },execution:{ maxRuntimeSeconds:1200 },providerOverrides:{ requiredCapabilities:['agent-execution'],maxRuntimeSeconds:900,instructionTemplateRefs:[{id:'template:planning',revision:1}] } });
		expect(validateAgentDefinitionModel(compiled.frontmatter)).toMatchObject({ ok:true,diagnostics:[] });
		planning.providerOverrides.maxRuntimeSeconds = 1800;
		expect(validateAgentDefinitionModel(compiled.frontmatter)).toMatchObject({ ok:false,diagnostics:expect.arrayContaining([expect.objectContaining({ path:'activityProfiles.planning.providerOverrides.maxRuntimeSeconds' })]) });
	});

	it('returns chat-addressable paths for malformed nested fields', () => {
		const compiled = compileAgentDefinition({ intent: intent(), projectId: 'project-1' });
		const planning = (compiled.frontmatter.activityProfiles as Record<string, Record<string, unknown>>).planning;
		planning.execution = { maxRuntimeSeconds: 0 };
		const validation = validateAgentDefinitionModel(compiled.frontmatter);

		expect(validation.ok).toBe(false);
		expect(validation.diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({ path: 'activityProfiles.planning.execution.maxRuntimeSeconds' }),
		]));
	});

	it('validates assignment closeout warning configuration through Zod', () => {
		const compiled = compileAgentDefinition({ intent: intent(), projectId: 'project-1' });
		const planning = (compiled.frontmatter.activityProfiles as Record<string, Record<string, unknown>>).planning;
		planning.execution = { maxRuntimeSeconds: 900, closeoutWarningSeconds: 120 };
		expect(validateAgentDefinitionModel(compiled.frontmatter)).toMatchObject({ ok: true });
		planning.execution = { maxRuntimeSeconds: 900, closeoutWarningSeconds: 0 };
		expect(validateAgentDefinitionModel(compiled.frontmatter)).toMatchObject({
			ok: false,
			diagnostics: expect.arrayContaining([expect.objectContaining({ path: 'activityProfiles.planning.execution.closeoutWarningSeconds' })]),
		});
	});
});
