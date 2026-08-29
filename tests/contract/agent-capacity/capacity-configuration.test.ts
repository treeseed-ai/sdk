import { describe, expect, it } from 'vitest';
import { validateCapacityAllocationSetV2, validateCapacityGrantV2 } from '../../../src/agent-capacity/validation/allocation.ts';
import { validateAgentActivityProfilesConfiguration } from '../../../src/agent-capacity/validation/activity-profile.ts';
import { validateProjectAgentClassConfiguration } from '../../../src/agent-capacity/validation/configuration.ts';
import { CAPACITY_CONFIGURATION_DESCRIPTORS, CAPACITY_CONFIGURATION_FAMILIES } from '../../../src/agent-capacity/contracts/configuration/configuration.ts';
import { validateCapacityProviderManifestV3, validateProviderSupplyOffer } from '../../../src/capacity-provider/validation.ts';
import { compileAgentAuthoritySnapshot } from '../../../src/agent-capacity/authority/agent-authority-presets.ts';

const validators = {
	'provider-manifest': validateCapacityProviderManifestV3,
	'provider-offer': validateProviderSupplyOffer,
	'capacity-grant': validateCapacityGrantV2,
	'allocation-set': validateCapacityAllocationSetV2,
	'project-agent-class': validateProjectAgentClassConfiguration,
	'activity-profile': validateAgentActivityProfilesConfiguration,
} as const;

describe('capacity configuration inventory', () => {
	it('gives chat profiles project source read tools without source mutation authority', () => {
		const snapshot = compileAgentAuthoritySnapshot('chat', {
			activityType: 'chat', enabled: true, handler: 'writer', prompt: { system: 'Discuss.' },
			branchPolicy: { kind: 'read-only', base: 'staging' }, permissions: { repository: { readPaths: ['**'], writePaths: [], allowCodeMutation: false } },
			tools: { allowed: [] }, outputs: { messageTypes: ['discussion_response'], modelMutations: [] }, execution: {},
		});
		expect(snapshot.tools.allowed).toEqual(expect.arrayContaining(['treeseed.repository.read_file', 'treeseed.repository.search']));
		expect(snapshot.permissions?.repository).toMatchObject({ readPaths: ['**'], writePaths: [], allowCodeMutation: false });
	});
	it('has one SDK-owned descriptor and validator for every declarative family', () => {
		expect(CAPACITY_CONFIGURATION_DESCRIPTORS.map((entry) => entry.id)).toEqual(CAPACITY_CONFIGURATION_FAMILIES);
		for (const descriptor of CAPACITY_CONFIGURATION_DESCRIPTORS) {
			expect(descriptor.ownerPackage).toBe('@treeseed/sdk');
			expect(validators[descriptor.id]).toBeTypeOf('function');
		}
	});

	it('fails closed on unknown activity fields, provider pins, and mismatched keyed activity types', () => {
		const result = validateAgentActivityProfilesConfiguration({
			planning: {
				activityType: 'acting', enabled: true, handler: 'writer', unexpected: true,
				prompt: { system: 'Plan.' }, branchPolicy: { kind: 'read-only', base: 'main' },
				tools: { allowed: [] }, outputs: { messageTypes: [], modelMutations: [] },
				execution: { providerPreference: ['codex'] },
			},
		});
		expect(result.ok).toBe(false);
		expect(result.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'agent_activity_unknown_field',
			'agent_activity_type_mismatch',
		]));
	});

	it('accepts typed proposal-linked planning intent and rejects malformed intent', () => {
		const base = {
			activityType: 'estimating', enabled: true, handler: 'estimate',
			prompt: { system: 'Estimate.' }, branchPolicy: { kind: 'read-only', base: 'main' },
			tools: { allowed: [] }, outputs: { messageTypes: [], modelMutations: ['estimate:create'] },
		};
		expect(validateAgentActivityProfilesConfiguration({ estimating: { ...base, planningIntent: { subjectModel: 'proposal', proposalTypes: ['technical-accuracy'] } } })).toEqual({ ok: true, diagnostics: [] });
		expect(validateAgentActivityProfilesConfiguration({ estimating: { ...base, planningIntent: { subjectModel: '', includeWorkdayArtifacts: 'yes' } } }).diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'agent_activity_planning_intent_text_invalid',
			'agent_activity_planning_intent_boolean_invalid',
		]));
	});

	it('accepts project agent classes as governed question answerers', () => {
		const profile = {
			planning: {
				activityType: 'planning', enabled: true, handler: 'writer',
				prompt: { system: 'Plan.' }, branchPolicy: { kind: 'read-only', base: 'main' },
				tools: { allowed: [], denied: [
					'treeseed.content.create', 'treeseed.content.update',
					'treeseed.content.link', 'treeseed.content.commit',
				] }, outputs: { messageTypes: [], modelMutations: [] },
				questionPolicy: { blockExecutionWhenCreated: true, defaultAnswerPolicy: { kind: 'human-or-agent', allowedAgentClasses: ['architecture'] } },
				execution: { requiredCapabilities: ['agent-execution'] },
			},
		};
		expect(validateAgentActivityProfilesConfiguration(profile)).toEqual({ ok: true, diagnostics: [] });
	});

	it('fails closed on unknown project-agent-class configuration fields', () => {
		const result = validateProjectAgentClassConfiguration({ id: 'engineer', slug: 'engineer', allowedModes: ['planning'], requiredCapabilities: ['engineering'], obsoletePolicy: {} });
		expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'project_agent_class_configuration_unknown_field', path: 'obsoletePolicy' }] });
	});
});
