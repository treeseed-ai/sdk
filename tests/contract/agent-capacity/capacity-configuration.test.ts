import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { validateCapacityAllocationSetV2, validateCapacityGrantV2 } from '../../../src/agent-capacity/validation/allocation.ts';
import { validateAgentActivityProfilesConfiguration } from '../../../src/agent-capacity/validation/activity-profile.ts';
import { validateProjectAgentClassConfiguration } from '../../../src/agent-capacity/validation/configuration.ts';
import { CAPACITY_CONFIGURATION_DESCRIPTORS, CAPACITY_CONFIGURATION_FAMILIES } from '../../../src/agent-capacity/contracts/configuration.ts';
import { validateCapacityProviderManifestV2, validateProviderSupplyOffer } from '../../../src/capacity-provider/validation.ts';

const packageRoot = process.cwd();
const validators = {
	'provider-manifest': validateCapacityProviderManifestV2,
	'provider-offer': validateProviderSupplyOffer,
	'capacity-grant': validateCapacityGrantV2,
	'allocation-set': validateCapacityAllocationSetV2,
	'project-agent-class': validateProjectAgentClassConfiguration,
	'activity-profile': validateAgentActivityProfilesConfiguration,
} as const;

describe('capacity configuration inventory', () => {
	it('has one SDK-owned descriptor and valid round-trip example for every declarative family', () => {
		expect(CAPACITY_CONFIGURATION_DESCRIPTORS.map((entry) => entry.id)).toEqual(CAPACITY_CONFIGURATION_FAMILIES);
		for (const descriptor of CAPACITY_CONFIGURATION_DESCRIPTORS) {
			const source = readFileSync(resolve(packageRoot, descriptor.examplePath), 'utf8');
			const parsed = parseYaml(source);
			const roundTripped = JSON.parse(JSON.stringify(parsed));
			expect(validators[descriptor.id](roundTripped as never), descriptor.id).toEqual({ ok: true, diagnostics: [] });
			expect(descriptor.ownerPackage).toBe('@treeseed/sdk');
		}
	});

	it('fails closed on unknown activity fields and mismatched keyed activity types', () => {
		const result = validateAgentActivityProfilesConfiguration({
			planning: {
				activityType: 'acting', enabled: true, handler: 'writer', unexpected: true,
				prompt: { system: 'Plan.' }, branchPolicy: { kind: 'read-only', base: 'main' },
				tools: { allowed: [] }, outputs: { messageTypes: [], modelMutations: [] },
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
		expect(validateAgentActivityProfilesConfiguration({ estimating: { ...base, planningIntent: { subjectModel: 'proposal' } } })).toEqual({ ok: true, diagnostics: [] });
		expect(validateAgentActivityProfilesConfiguration({ estimating: { ...base, planningIntent: { subjectModel: '', includeWorkdayArtifacts: 'yes' } } }).diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'agent_activity_planning_intent_text_invalid',
			'agent_activity_planning_intent_boolean_invalid',
		]));
	});

	it('fails closed on unknown project-agent-class configuration fields', () => {
		const result = validateProjectAgentClassConfiguration({ id: 'engineer', slug: 'engineer', allowedModes: ['planning'], requiredCapabilities: ['engineering'], obsoletePolicy: {} });
		expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'project_agent_class_configuration_unknown_field', path: 'obsoletePolicy' }] });
	});
});
