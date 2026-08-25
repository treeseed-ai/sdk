import { describe, expect, it } from 'vitest';
import { digestSeedBundle, type SeedBundleV2, type SeedBundleV3, validateSeedBundle } from '../../../src/operator-contracts/seed/seed-bundle.ts';

function bundle(): Omit<SeedBundleV3, 'digest'> {
	return {
		schemaVersion: 'treeseed.seed-bundle/v3', name: 'treeseed', version: 3, description: 'TreeSeed portfolio', environments: ['local'],
		resources: {
			teams: [{ key: 'team:treeseed', slug: 'treeseed', name: 'treeseed', displayName: 'TreeSeed' }],
			memberships: [
				{ key: 'membership:treeseed/adrian', team: 'team:treeseed', principal: { kind: 'user', email: 'adrian.webb@knowledge.coop' }, roles: ['team_owner'], missingUser: 'defer' },
				{ key: 'membership:treeseed/automation', team: 'team:treeseed', principal: { kind: 'service-principal', key: 'service-principal:treeseed/automation', displayName: 'TreeSeed automation', interactiveLogin: false }, roles: ['team_owner'] },
			],
			projects: [{ key: 'project:treeseed/sdk', team: 'team:treeseed', slug: 'sdk', name: 'SDK', description: 'Contracts', kind: 'package', primaryRepository: 'repository:treeseed/sdk', libraryRepository: 'repository:treeseed/sdk-library' }],
			repositories: [
				{ key: 'repository:treeseed/sdk', project: 'project:treeseed/sdk', role: 'primary', provider: 'github', owner: 'treeseed-ai', name: 'sdk', gitUrl: 'git@github.com:treeseed-ai/sdk.git', defaultBranch: 'main', repositoryPolicy: { visibility: 'public', lifecycle: 'adopt', deletionPolicy: 'retain', defaultBranch: 'main', stagingBranch: 'staging', issues: true, actions: true, workflows: ['verify.yml'] } },
				{ key: 'repository:treeseed/sdk-library', project: 'project:treeseed/sdk', role: 'library', provider: 'github', owner: 'treeseed-ai', name: 'sdk-library', gitUrl: 'https://github.com/treeseed-ai/sdk-library.git', defaultBranch: 'main', repositoryPolicy: { visibility: 'public', lifecycle: 'create-or-adopt', deletionPolicy: 'retain', defaultBranch: 'main', stagingBranch: 'staging', issues: true, actions: true, workflows: ['verify.yml'] } },
			],
		},
		runtime: { capacityProviders: [{ key: 'capacity-provider:treeseed/local', team: 'team:treeseed', environments: ['local'], manifestDigest: `sha256:${'a'.repeat(64)}`, manifestRef: 'treeseed.capacity-provider.yaml', approval: 'trusted-local-owner', projects: ['project:treeseed/sdk'], allowedModes: ['planning', 'acting'], requiredLanePurposes: ['communication', 'platform', 'workday'] }] },
	};
}

describe('portable seed bundle', () => {
	it('has a deterministic content digest and validates portable authority resources', async () => {
		const input = bundle();
		const digest = await digestSeedBundle(input);
		const value = { ...input, digest };
		expect(await digestSeedBundle({ ...value, resources: { ...value.resources, teams: [...value.resources.teams] } })).toBe(digest);
		expect(validateSeedBundle(value)).toEqual([]);
	});

	it('rejects interactive service principals and incomplete provider lanes', async () => {
		const input = bundle();
		const value = { ...input, digest: await digestSeedBundle(input) } as SeedBundleV3;
		(value.resources.memberships[1]!.principal as { interactiveLogin: boolean }).interactiveLogin = true;
		value.runtime.capacityProviders[0]!.requiredLanePurposes = ['communication'];
		expect(validateSeedBundle(value).map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'seed_bundle_service_principal_interactive_forbidden', 'seed_bundle_provider_lane_required',
		]));
	});

	it('allows a content-only project without a primary repository when it has a library', async () => {
		const input = bundle();
		input.resources.projects.push({ key: 'project:treeseed/knowledge', team: 'team:treeseed', slug: 'knowledge', name: 'Knowledge', description: 'Content-only knowledge.', kind: 'content', libraryRepository: 'repository:treeseed/knowledge-library' });
		input.resources.repositories.push({ ...input.resources.repositories[1]!, key: 'repository:treeseed/knowledge-library', project: 'project:treeseed/knowledge', name: 'knowledge-library', gitUrl: 'https://github.com/treeseed-ai/knowledge-library.git' });
		const value = { ...input, digest: await digestSeedBundle(input) };
		expect(validateSeedBundle(value)).toEqual([]);
	});

	it('requires primary and exactly one matching library repository', async () => {
		const input = bundle();
		delete input.resources.projects[0]!.primaryRepository;
		(input.resources.repositories as Array<Record<string, unknown>>).push({
			...input.resources.repositories[0],
			key: 'repository:treeseed/sdk-content', project: 'project:treeseed/sdk',
			role: 'content',
		});
		delete input.resources.projects[0]!.libraryRepository;
		const value = { ...input, digest: await digestSeedBundle(input) } as SeedBundleV3;
		expect(validateSeedBundle(value).map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'seed_bundle_primary_repository_required',
			'seed_bundle_library_repository_required',
			'seed_bundle_content_repository_renamed',
		]));
	});

	it('decodes v2 receipts but requires migration before reconciliation', async () => {
		const input = bundle() as unknown as Omit<SeedBundleV2, 'digest'>;
		input.schemaVersion = 'treeseed.seed-bundle/v2';
		const value = { ...input, digest: await digestSeedBundle(input) } as SeedBundleV2;
		expect(validateSeedBundle(value).map((entry) => entry.code)).toContain('seed_bundle_v2_migration_required');
	});
});
