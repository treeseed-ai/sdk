import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_OPERATIONS } from '../../../src/operator-contracts/control-plane-operations.ts';
import { getServiceProviderDefinition } from '../../../src/secrets-capability/service-provider-contracts.ts';

describe('hosted topology operator authority', () => {
	it('publishes read-only plan/status and authority-gated apply/rollback operations', () => {
		const topology = CONTROL_PLANE_OPERATIONS.infrastructure.topology;
		expect(topology.plan.descriptor).toMatchObject({ kind: 'read', confirmation: 'never', idempotency: { required: false } });
		expect(topology.status.descriptor).toMatchObject({ kind: 'read', confirmation: 'never' });
		expect(topology.apply.descriptor).toMatchObject({ kind: 'mutation', riskClass: 'authority', concurrency: { required: true } });
		expect(topology.rollback.descriptor).toMatchObject({ kind: 'mutation', riskClass: 'destructive', concurrency: { required: true } });
		expect(JSON.stringify(topology)).not.toMatch(/apiToken|password|privateKey|registrationCode/u);
	});

	it('permits unattended references without accepting provider credential values', () => {
		for (const providerId of ['cloudflare', 'railway']) {
			const provider = getServiceProviderDefinition(providerId)!;
			expect(provider.credentialProfiles.every(({ unattendedCompatible }) => unattendedCompatible)).toBe(true);
			expect(provider.credentialProfiles.every(({ authoritySchemes }) => authoritySchemes?.length === 1 && authoritySchemes.includes('openbao'))).toBe(true);
			expect(provider.credentialProfiles.every(({ fields }) => fields.every(({ sensitive }) => sensitive))).toBe(true);
		}
	});
});
