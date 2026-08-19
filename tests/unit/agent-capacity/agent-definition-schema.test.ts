import { readdirSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe,expect,it } from 'vitest';
import { compileAgentDefinition } from '../../../src/agent-capacity/authoring/agent-definition-authoring.ts';
import { validateAgentActivityProfileCompatibility } from '../../../src/agent-capacity/validation/compatibility/agent-definition-compatibility.ts';
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
				permissions: { content: { proposal: { operations: ['create','update','link','commit'] } }, commit: { allowed: true } },
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
		Object.assign(planning,{ contextQueryRefs:[{id:'query:planning',revision:1}],contextQuerySetRefs:[{id:'set:planning',revision:1}],instructionTemplateRefs:[{id:'template:planning',revision:1}],permissions:{ content:{ note:{ operations:['read','create','update','link','commit'],filters:{ status:'live' } } },commit:{ allowed:true },network:{ allowWeb:false } },artifactTriggers:[{ event:'assignment.completed',artifactKind:'assignment_summary',required:true }],closeoutPolicy:{ warningSeconds:120,summaryRequired:true },execution:{ maxRuntimeSeconds:1200 },providerOverrides:{ requiredCapabilities:['agent-execution'],maxRuntimeSeconds:900,instructionTemplateRefs:[{id:'template:planning',revision:1}] } });
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

	it('accepts every shipped project agent definition', () => {
		const root = resolve(process.cwd(),'docs/src/content/agents');
		for (const name of readdirSync(root).filter((entry) => entry.endsWith('.mdx'))) {
			const source = readFileSync(resolve(root,name),'utf8');
			const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
			expect(match,`${name} must contain YAML frontmatter`).not.toBeNull();
			const definition = parseYaml(match![1]) as Record<string,any>;
			expect(validateAgentDefinitionModel(definition),name).toMatchObject({ ok:true,diagnostics:[] });
			for (const [activityType,profile] of Object.entries(definition.activityProfiles ?? {}) as Array<[any,any]>) {
				if (profile.enabled) expect(validateAgentActivityProfileCompatibility(activityType,profile),name).toMatchObject({ ok:true,diagnostics:[] });
			}
		}
	});

	it('rejects writable content on read-only branches before provider admission', () => {
		const compiled = compileAgentDefinition({ intent:intent(),projectId:'project-1' });
		const planning = (compiled.frontmatter.activityProfiles as Record<string,any>).planning;
		planning.branchPolicy = { kind:'read-only',base:'main' };
		expect(validateAgentDefinitionModel(compiled.frontmatter)).toMatchObject({ ok:true,diagnostics:[] });
		expect(validateAgentActivityProfileCompatibility('planning',planning)).toMatchObject({
			ok:false,
			diagnostics:expect.arrayContaining([expect.objectContaining({
				code:'agent_activity_read_only_write_conflict',
				path:'activityProfiles.planning.branchPolicy.kind',
			})]),
		});
	});

	it('rejects source assignments that cannot verify and checkpoint bounded paths', () => {
		const compiled = compileAgentDefinition({ intent:intent(),projectId:'project-1' });
		const planning = (compiled.frontmatter.activityProfiles as Record<string,any>).planning;
		planning.activityType = 'acting';
		planning.handler = 'actor';
		planning.branchPolicy = { kind:'assignment-feature',base:'staging',target:'staging' };
		planning.execution = { verificationRequired:false };
		expect(validateAgentDefinitionModel({ ...compiled.frontmatter,activityProfiles:{ acting:planning } })).toMatchObject({ ok:true,diagnostics:[] });
		expect(validateAgentActivityProfileCompatibility('acting',planning)).toMatchObject({
			ok:false,
			diagnostics:expect.arrayContaining([
				expect.objectContaining({ code:'agent_activity_source_verification_required' }),
				expect.objectContaining({ code:'agent_activity_source_paths_required' }),
			]),
		});
	});

	it('rejects unsatisfiable source paths and all effective provider requirements', () => {
		const compiled = compileAgentDefinition({ intent:intent(),projectId:'project-1' });
		const profile = (compiled.frontmatter.activityProfiles as Record<string,any>).planning;
		profile.activityType = 'acting';
		profile.handler = 'actor';
		profile.branchPolicy = { kind:'assignment-feature',base:'staging',target:'staging' };
		profile.tools.allowed = ['treeseed.repository.read_file','treeseed.repository.search','treeseed.changed_paths','treeseed.verify','treeseed.checkpoint'];
		profile.execution = { verificationRequired:true,requiredCapabilities:['repo_write'],allowedPaths:['src/**'],forbiddenPaths:['src/**'] };
		profile.providerOverrides = { requiredCapabilities:['gpu'] };

		expect(validateAgentDefinitionModel({ ...compiled.frontmatter,activityProfiles:{ acting:profile } })).toMatchObject({ ok:true,diagnostics:[] });
		expect(validateAgentActivityProfileCompatibility('acting',profile,{ availableProviderCapabilities:['repo_write'] })).toMatchObject({
			ok:false,
			diagnostics:expect.arrayContaining([
				expect.objectContaining({ code:'agent_activity_source_paths_unsatisfiable',path:'activityProfiles.acting.execution.allowedPaths' }),
				expect.objectContaining({ code:'agent_activity_provider_capability_unsatisfied',path:'activityProfiles.acting.providerOverrides.requiredCapabilities' }),
			]),
		});
	});
});
