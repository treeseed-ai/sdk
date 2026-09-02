import { describe, expect, it } from 'vitest';
import {
	CREDENTIAL_AUTHORITY_SCHEMES,
	SERVICE_CAPABILITY_TYPES,
	SERVICE_PROVIDER_CATALOG,
} from '../../../src/configuration/secrets-capability.ts';

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
			.toMatchObject({ fields: [], authoritySchemes: ['app-installation'] });
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

	it('exposes non-secret hosted adoption targets without embedding installation identities', () => {
		const cloudflare = SERVICE_PROVIDER_CATALOG.find((provider) => provider.id === 'cloudflare');
		const railway = SERVICE_PROVIDER_CATALOG.find((provider) => provider.id === 'railway');
		expect(cloudflare?.connectionFields).toMatchObject([{ key: 'accountId', required: true, sensitive: false }, { key: 'zoneId', required: false, sensitive: false }]);
		expect(railway?.connectionFields).toMatchObject([{ key: 'workspaceId', required: true, sensitive: false }, { key: 'projectId', required: false, sensitive: false }, { key: 'environmentId', required: false, sensitive: false }]);
	});

});
