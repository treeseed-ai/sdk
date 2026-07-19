import { describe, expect, it } from 'vitest';
import {
	CAPACITY_OPERATOR_CAPABILITIES,
	renderCapacityOperatorCapabilityMarkdown,
	validateCapacityOperatorCapabilityMatrix,
} from '../../src/agent-capacity/contracts/operator-surface.ts';
import { CAPACITY_CONFIGURATION_DESCRIPTORS } from '../../src/agent-capacity/contracts/configuration.ts';

describe('capacity operator capability matrix', () => {
	it('has one owner for every operation and explicit idempotency for API mutations', () => {
		expect(validateCapacityOperatorCapabilityMatrix()).toEqual({ ok: true, diagnostics: [] });
		expect(CAPACITY_OPERATOR_CAPABILITIES.length).toBeGreaterThanOrEqual(70);
		expect(CAPACITY_OPERATOR_CAPABILITIES.every((entry) => Boolean(entry.access))).toBe(true);
		expect(CAPACITY_OPERATOR_CAPABILITIES.find((entry) => entry.id === 'registration-key.reveal')?.access).toBe('team-manage');
		expect(CAPACITY_OPERATOR_CAPABILITIES.find((entry) => entry.id === 'allocations.explain')?.access).toBe('team-read');
		expect(CAPACITY_OPERATOR_CAPABILITIES.find((entry) => entry.id === 'provider.credential-rotate')?.access).toBe('provider-access-token');
	});

	it('covers every required declarative backend configuration family', () => {
		const configured = new Set(CAPACITY_OPERATOR_CAPABILITIES.flatMap((entry) => entry.configurationInputs ?? (entry.configuration ? [entry.configuration] : [])));
		expect(configured).toEqual(new Set([
			'provider-manifest',
			'provider-offer',
			'capacity-grant',
			'allocation-set',
			'project-agent-class',
			'activity-profile',
		]));
	});

	it('marks every bounded collection and secret-bearing registration operation', () => {
		const paginated = CAPACITY_OPERATOR_CAPABILITIES.filter((entry) => entry.paginated);
		expect(paginated.map((entry) => entry.id)).toEqual(expect.arrayContaining([
			'registration-requests.list',
			'memberships.list',
			'grants.list',
			'allocations.list',
			'assignments.list',
			'reservations.list',
			'usage.show',
			'ledger.show',
			'audit.list',
		]));
		expect(CAPACITY_OPERATOR_CAPABILITIES.filter((entry) => entry.secretConfirmation).map((entry) => entry.id))
			.toEqual(['registration-key.reveal', 'registration-key.rotate']);
	});

	it('renders deterministic descriptor-backed parity documentation', () => {
		const markdown = renderCapacityOperatorCapabilityMarkdown();
		expect(markdown).toContain('| `registration-key.rotate` | `trsd capacity registration-key-rotate` | `post.v1.teams.teamId.capacity-registration-key.rotate` | mutation | team-manage |');
		expect(markdown).toContain('| `provider.runtime.test-local` | `trsd capacity test-local` | local | local-runtime | provider-owner-local |');
		expect(markdown).toContain('| `activity-profile` | `treeseed.agent-activity-profiles/v1` | `validateAgentActivityProfilesConfiguration` |');
		expect(markdown.split('\n').filter((line) => line.startsWith('| `'))).toHaveLength(CAPACITY_OPERATOR_CAPABILITIES.length + CAPACITY_CONFIGURATION_DESCRIPTORS.length);
	});
});
