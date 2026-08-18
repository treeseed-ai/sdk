import { describe, expect, it } from 'vitest';
import {
	CREDENTIAL_AUTHORITY_SCHEMES,
	SERVICE_CAPABILITY_TYPES,
	SERVICE_PROVIDER_CATALOG,
	normalizeProjectRepositoryTopology,
} from '../../../src/index.ts';

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

	it('normalizes a complete remote repository binding and fails incomplete input closed', () => {
		const base = {
			contentRepository: {
				accessMode: 'treedx', contentPath: 'docs/src/content',
				treeDx: { instanceId: 'node-1', libraryId: 'team/project' },
				remote: {
					bindingId: 'binding-1', serviceConnectionId: 'connection-1', capabilityBindingId: 'capability-1',
					providerId: 'github', providerRepositoryId: '123', owner: 'treeseed-ai', name: 'admin',
					cloneUrl: 'https://github.com/treeseed-ai/admin.git', defaultRef: 'main', publicationRef: 'staging',
					authorityId: 'authority-1', grantStatus: 'ready', drift: 'none', version: 1,
				},
			},
			siteRepository: { accessMode: 'filesystem', name: 'docs' },
		};
		expect(normalizeProjectRepositoryTopology(base).contentRepository.remote?.providerRepositoryId).toBe('123');
		expect(() => normalizeProjectRepositoryTopology({
			...base,
			contentRepository: { ...base.contentRepository, remote: { bindingId: 'partial' } },
		})).toThrow(/missing/i);
	});
});
