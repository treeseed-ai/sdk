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
			.toMatchObject({ fields: [], authoritySchemes: ['app-installation'], permissions: [
				'Metadata: read', 'Contents: read and write', 'Checks: read', 'Administration: read and write',
			] });
		expect(github?.credentialProfiles.find((profile) => profile.id === 'github-workflow-app')?.capabilities)
			.toEqual(['workflow-execution', 'workflow-configuration', 'secret-enclave']);
		expect(github?.credentialProfiles.find((profile) => profile.id === 'github-workflow-app'))
			.toMatchObject({ fields: [], authoritySchemes: ['app-installation'] });
		expect(github?.connectionFields.map((field) => field.key)).toEqual(['organization']);
	});

	it('exposes App installation and managed OpenBao authority only', () => {
		expect(CREDENTIAL_AUTHORITY_SCHEMES).toEqual(expect.arrayContaining([
			'app-installation', 'openbao',
		]));
		expect(SERVICE_CAPABILITY_TYPES).toContain('workflow-configuration');
		expect(SERVICE_CAPABILITY_TYPES).toContain('state-encryption');
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
		]);
		expect(cloudflare?.credentialProfiles.find(({ id }) => id === 's3-state-session')?.fields.map(({ key, required, sensitive }) => ({ key, required, sensitive }))).toEqual([
			{ key: 'accessKeyId', required: true, sensitive: true },
			{ key: 'secretAccessKey', required: true, sensitive: true },
			{ key: 'sessionToken', required: false, sensitive: true },
		]);
		expect(cloudflare?.credentialProfiles.find(({ id }) => id === 'opentofu-state-encryption')?.fields.map(({ key, sensitive }) => ({ key, sensitive }))).toEqual([
			{ key: 'stateEncryptionKey', sensitive: true },
		]);
		expect(cloudflare?.capabilities.find(({ type }) => type === 'object-storage')?.credentialProfileIds).toEqual(['cloudflare-storage', 's3-state-session']);
		expect(cloudflare?.capabilities.find(({ type }) => type === 'state-encryption')?.credentialProfileIds).toEqual(['opentofu-state-encryption']);
		expect(cloudflare?.credentialProfiles.filter(({ id }) => id.startsWith('cloudflare-')).every(({ authoritySchemes }) => authoritySchemes?.includes('openbao'))).toBe(true);
		expect(railway?.credentialProfiles.find(({ id }) => id === 'railway-workspace')?.authoritySchemes).toContain('openbao');
	});

});
