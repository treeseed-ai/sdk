import { describe, expect, it } from 'vitest';
import {
	CREDENTIAL_AUTHORITY_SCHEMES,
	SECRET_OPERATION_PURPOSES,
	SERVICE_CAPABILITY_TYPES,
	SERVICE_PROVIDER_CATALOG,
	canonicalHostedSecretOperationBinding,
	validateHostedSecretOperationBinding,
	validateSealedSecretOperationPayload,
} from '../../../src/configuration/secrets-capability.ts';

const hostedBinding = {
	subjectType: 'plan' as const,
	subjectDigest: `sha256:${'a'.repeat(64)}`,
	deploymentId: 'treeseed-cloud',
	stackId: 'control-plane',
	environment: 'staging' as const,
};

describe('provider operation contracts', () => {
	it('keeps repository and workflow GitHub authority least-privilege and independently selectable', () => {
		const github = SERVICE_PROVIDER_CATALOG.find((provider) => provider.id === 'github');
		expect(github).toBeDefined();
		expect(github?.capabilities.map((capability) => capability.type)).toEqual([
			'repository-hosting', 'workflow-execution', 'workflow-configuration', 'secret-enclave',
		]);
		expect(github?.credentialProfiles.find((profile) => profile.id === 'github-repository-app')?.capabilities)
			.toEqual(['repository-hosting']);
		expect(github?.credentialProfiles.find((profile) => profile.id === 'github-repository-app'))
			.toMatchObject({ fields: [], authoritySchemes: ['app-installation'], permissions: [
				'Metadata: read', 'Contents: read and write', 'Checks: read', 'Administration: read and write',
			] });
		expect(github?.credentialProfiles.find((profile) => profile.id === 'github-workflow-app')?.capabilities)
			.toEqual(['workflow-execution', 'workflow-configuration', 'secret-enclave']);
		expect(github?.credentialProfiles.find((profile) => profile.id === 'github-workflow-app'))
			.toMatchObject({ fields: [], authoritySchemes: ['app-installation'] });
		expect(github?.connectionFields.map((field) => field.key)).toEqual(['organization']);
	});

	it('preserves app, token, environment, encrypted, and workload authority schemes', () => {
		expect(CREDENTIAL_AUTHORITY_SCHEMES).toEqual(expect.arrayContaining([
			'app-installation', 'api-token', 'environment-reference', 'client-encrypted', 'external-vault', 'workload-identity',
		]));
		expect(SERVICE_CAPABILITY_TYPES).toContain('workflow-configuration');
	});

	it('binds sealed interactive credentials to exact hosted operations', () => {
		expect(SECRET_OPERATION_PURPOSES).toEqual(expect.arrayContaining([
			'hosted-topology-plan', 'hosted-topology-apply', 'hosted-topology-readback', 'hosted-topology-rollback',
		]));
		expect(canonicalHostedSecretOperationBinding(hostedBinding)).toBe(JSON.stringify(hostedBinding));
		expect(validateHostedSecretOperationBinding(hostedBinding)).toBe(true);
		expect(validateHostedSecretOperationBinding({ ...hostedBinding, subjectDigest: 'moving-head' })).toBe(false);
		const payload = { schemaVersion: 'treeseed.sealed-secret-operation-payload/v1', leaseId: 'lease-1', teamId: 'team-1',
			operationCorrelationId: 'operation-1', hostedBinding, algorithm: 'x25519-sealed-box', ciphertext: 'base64-ciphertext' };
		expect(validateSealedSecretOperationPayload(payload)).toBe(true);
		expect(validateSealedSecretOperationPayload({ ...payload, ciphertext: '' })).toBe(false);
		expect(validateSealedSecretOperationPayload({ ...payload, hostedBinding: { ...hostedBinding, environment: 'preview' } })).toBe(false);
	});

	it('exposes non-secret hosted adoption targets without embedding installation identities', () => {
		const cloudflare = SERVICE_PROVIDER_CATALOG.find((provider) => provider.id === 'cloudflare');
		const railway = SERVICE_PROVIDER_CATALOG.find((provider) => provider.id === 'railway');
		expect(cloudflare?.connectionFields).toMatchObject([
			{ key: 'deploymentEnvironment', required: true, sensitive: false },
			{ key: 'accountId', required: true, sensitive: false },
			{ key: 'zoneId', required: false, sensitive: false },
			{ key: 'stateBucket', required: false, sensitive: false },
			{ key: 'stateEndpoint', required: false, sensitive: false },
			{ key: 'stateRegion', required: false, sensitive: false },
			{ key: 'stateEncryptionKeyRef', required: false, sensitive: false },
		]);
		expect(railway?.connectionFields).toMatchObject([{ key: 'deploymentEnvironment', required: true, sensitive: false }, { key: 'workspaceId', required: true, sensitive: false }, { key: 'projectId', required: false, sensitive: false }, { key: 'environmentId', required: false, sensitive: false }]);
		expect(cloudflare?.credentialProfiles.find(({ id }) => id === 'cloudflare-storage')?.fields.map(({ key, sensitive }) => ({ key, sensitive }))).toEqual([
			{ key: 'apiToken', sensitive: true },
			{ key: 'accessKeyId', sensitive: true },
			{ key: 'secretAccessKey', sensitive: true },
			{ key: 'stateEncryptionKey', sensitive: true },
		]);
		expect(cloudflare?.credentialProfiles.filter(({ id }) => id.startsWith('cloudflare-')).every(({ authoritySchemes }) => authoritySchemes?.includes('client-encrypted'))).toBe(true);
		expect(railway?.credentialProfiles.find(({ id }) => id === 'railway-workspace')?.authoritySchemes).toContain('client-encrypted');
	});

});
