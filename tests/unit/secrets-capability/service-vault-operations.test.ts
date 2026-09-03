import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_OPERATIONS } from '../../../src/operator-contracts/control-plane-operations.ts';

describe('service vault operator contracts', () => {
	it('accepts nullable and collection read results', () => {
		expect(CONTROL_PLANE_OPERATIONS.services.userVaultKey.schema.output.parse(null)).toBeNull();
		expect(CONTROL_PLANE_OPERATIONS.services.teamVault.schema.output.parse(null)).toBeNull();
		expect(CONTROL_PLANE_OPERATIONS.services.credentialEnvelopes.schema.output.parse([])).toEqual([]);
	});

	it('rejects plaintext-bearing credential and lease bodies', () => {
		expect(() => CONTROL_PLANE_OPERATIONS.services.putCredentialEnvelope.schema.body.parse({
			definitionId: 'cloudflare-runtime', fieldKey: 'apiToken', keyVersion: 1,
			envelope: { credentialValue: 'plaintext' },
		})).toThrow();
		expect(() => CONTROL_PLANE_OPERATIONS.services.createOperationLease.schema.body.parse({
			connectionId: 'connection-1', capabilityType: 'runtime-hosting', credentialProfileId: 'cloudflare-runtime',
			purpose: 'hosted-topology-plan', apiToken: 'plaintext',
		})).toThrow();
	});
});

