import { describe, expect, it } from 'vitest';
import { validateCapacityAllocationSetV2, validateCapacityGrantV2 } from '../../../src/agent-capacity/validation/allocation.ts';
import { validateAgentActivityProfilesConfiguration } from '../../../src/agent-capacity/validation/activity-profile.ts';
import { validateProjectAgentClassConfiguration } from '../../../src/agent-capacity/validation/configuration.ts';
import { CAPACITY_CONFIGURATION_DESCRIPTORS, CAPACITY_CONFIGURATION_FAMILIES } from '../../../src/agent-capacity/contracts/configuration/configuration.ts';
import { validateCapacityProviderManifestV5, validateProviderSupplyOffer } from '../../../src/capacity-provider/validation.ts';
import { validateAgentDefinitionModel } from '../../../src/agent-capacity/validation/agent-definition-schema.ts';

const validators = {
	'provider-manifest': validateCapacityProviderManifestV5,
	'provider-offer': validateProviderSupplyOffer,
	'capacity-grant': validateCapacityGrantV2,
	'allocation-set': validateCapacityAllocationSetV2,
	'project-agent-class': validateProjectAgentClassConfiguration,
	'activity-profile': validateAgentActivityProfilesConfiguration,
} as const;

describe('capacity configuration inventory', () => {
	it('has one SDK-owned descriptor and validator for every declarative family', () => {
		expect(CAPACITY_CONFIGURATION_DESCRIPTORS.map((entry) => entry.id)).toEqual(CAPACITY_CONFIGURATION_FAMILIES);
		for (const descriptor of CAPACITY_CONFIGURATION_DESCRIPTORS) {
			expect(descriptor.ownerPackage).toBe('@treeseed/sdk');
			expect(validators[descriptor.id]).toBeTypeOf('function');
		}
	});

	it('accepts the minimal profile and preserves project-owned handler IDs', () => {
		const result = validateAgentActivityProfilesConfiguration({
			acting: {
				handler: 'sdk/project-handler',
				dependsOn: { agents: ['tester'] },
				permissions: {
					content: { read: ['book', 'knowledge', 'decision'], write: [] },
					tools: ['source.read', 'source.write', 'verification'],
				},
				prompt: { system: 'Implement the accepted work with the smallest complete change.' },
				additionalContext: ['assigned-source-scope'],
			},
		});
		expect(result).toEqual({ ok: true, diagnostics: [] });
	});

	it('rejects removed profile concepts instead of accepting compatibility aliases', () => {
		for (const field of ['enabled', 'branchPolicy', 'authorityPresets', 'tools', 'outputs', 'execution']) {
			const result = validateAgentActivityProfilesConfiguration({
				chat: {
					handler: 'writer',
					permissions: { content: { read: ['discussion'], write: ['discussion'] }, tools: ['discussion'] },
					prompt: { system: 'Answer the discussion using only the authorized project context.' },
					[field]: field === 'enabled' ? true : {},
				},
			});
			expect(result.ok, field).toBe(false);
			expect(result.diagnostics.some((entry) => entry.message.includes('Unrecognized key')), field).toBe(true);
		}
	});

	it('requires one handler, meaningful prompt, and permission ceiling', () => {
		const result = validateAgentActivityProfilesConfiguration({ chat: { handler: '', prompt: { system: 'short' } } });
		expect(result.ok).toBe(false);
		expect(result.diagnostics.map((entry) => entry.path)).toEqual(expect.arrayContaining([
			'activityProfiles.chat.handler',
			'activityProfiles.chat.permissions',
			'activityProfiles.chat.prompt.system',
		]));
	});

	it('reserves reviewing for the Reviewer class', () => {
		const activity = {
			handler: 'writer',
			permissions: { content: { read: ['decision'], write: ['note', 'decision'] }, tools: ['source.read', 'verification'] },
			prompt: { system: 'Review the exact candidate and record a formal disposition.' },
		};
		const base = {
			schemaVersion: 'treeseed.agent/v1', id: 'sdk/engineer', name: 'SDK Engineer', agentClass: 'engineer',
			purpose: 'Implement SDK work.', responsibilities: ['Implement accepted changes.'], capabilities: ['code-change'],
			context: { include: ['assignment-subject'] }, activityProfiles: { reviewing: activity },
		};
		expect(validateAgentDefinitionModel(base).ok).toBe(false);
		expect(validateAgentDefinitionModel({ ...base, id: 'sdk/reviewer', agentClass: 'reviewer' }).ok).toBe(true);
	});

	it('fails closed on unknown project-agent-class configuration fields', () => {
		const result = validateProjectAgentClassConfiguration({ id: 'engineer', slug: 'engineer', allowedModes: ['planning'], obsoletePolicy: {} });
		expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'project_agent_class_configuration_unknown_field', path: 'obsoletePolicy' }] });
	});
});
