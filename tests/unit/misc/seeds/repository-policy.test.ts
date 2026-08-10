import { describe,expect,it } from 'vitest';
import { compileSeedRepositoryUnits,validateSeedSource } from '../../../../src/seeds/index.ts';

const source = `
name: test
version: 1
environments: [local]
resources:
  teams:
    - { key: team:test, slug: test }
  teamMemberships: []
  projects:
    - key: project:test/app
      team: team:test
      slug: app
      name: App
      repository:
        role: primary
        provider: github
        owner: test
        name: app
        gitUrl: https://github.com/test/app.git
        repositoryPolicy: &policy
          visibility: public
          lifecycle: create-or-adopt
          deletionPolicy: retain
          defaultBranch: main
          stagingBranch: staging
          issues: true
          actions: true
          workflows: [verify.yml]
      architecture:
        topology: split_site_content
        rootPath: .
        sitePath: .
        contentRuntimeSource: r2_preview_overlay
        localContentMaterialization: none
  hubRepositories:
    - key: repository:test/app-content
      project: project:test/app
      role: content
      provider: github
      owner: test
      name: app-content
      gitUrl: https://github.com/test/app-content.git
      repositoryPolicy: *policy
  supportRepositories:
    - key: repository:test/fixtures
      provider: github
      owner: test
      name: fixtures
      gitUrl: https://github.com/test/fixtures.git
      repositoryPolicy: *policy
  products: []
  catalogArtifacts: []
runtime: { capacityProviders: [], agentLabServicePrincipals: [] }
operationRecipes: []
`;

describe('seed repository policy', () => {
	it('parses explicit lifecycle and retention policy for primary and content repositories', () => {
		const result = validateSeedSource(source);
		expect(result.ok).toBe(true);
		expect(result.manifest?.resources.projects[0]?.repository.repositoryPolicy).toMatchObject({ visibility: 'public', lifecycle: 'create-or-adopt', deletionPolicy: 'retain' });
		expect(result.manifest?.resources.hubRepositories[0]?.repositoryPolicy).toMatchObject({ defaultBranch: 'main', stagingBranch: 'staging' });
	});

	it('rejects destructive or ambiguous repository policy values', () => {
		const result = validateSeedSource(source.replace('deletionPolicy: retain', 'deletionPolicy: delete'));
		expect(result.ok).toBe(false);
		expect(result.diagnostics.map((entry) => entry.code)).toContain('seed.invalid_repository_policy');
	});

	it('compiles primary and content repositories into the canonical GitHub reconciliation graph', () => {
		const result = validateSeedSource(source);
		const units = compileSeedRepositoryUnits(result.manifest!, 'local');
		expect(units).toHaveLength(9);
		expect(units.map((unit) => unit.logicalName)).toEqual([
			'test/app-content:staging',
			'test/app:staging',
			'test/fixtures:staging',
			'test/app-content:main',
			'test/app:main',
			'test/fixtures:main',
			'test/app',
			'test/app-content',
			'test/fixtures',
		]);
		expect(units.every((unit) => unit.provider === 'github')).toBe(true);
		const repository = units.find((unit) => unit.logicalName === 'test/app')!;
		const bootstrap = units.find((unit) => unit.logicalName === 'test/app:main')!;
		const staging = units.find((unit) => unit.logicalName === 'test/app:staging')!;
		expect(repository.unitType).toBe('github-repository');
		expect(bootstrap).toMatchObject({ unitType: 'github-repository-bootstrap', dependencies: [repository.unitId] });
		expect(staging).toMatchObject({ unitType: 'github-branch', dependencies: [bootstrap.unitId] });
		expect(units.find((unit) => unit.logicalName === 'test/fixtures')?.metadata).toMatchObject({ repositoryRole: 'support' });
		expect(units.find((unit) => unit.logicalName === 'test/app-content')?.metadata).toMatchObject({ repositoryRole: 'content' });
	});

	it('orders persistent repository lifecycle through environment and workflow observation', () => {
		const result = validateSeedSource(source.replace('environments: [local]', 'environments: [local, staging]'));
		const units = compileSeedRepositoryUnits(result.manifest!, 'staging');
		const branch = units.find((unit) => unit.logicalName === 'test/app:staging')!;
		const environment = units.find((unit) => unit.unitType === 'github-environment' && unit.logicalName === 'test/app:staging')!;
		const rules = units.find((unit) => unit.logicalName === 'test/app:main:rules')!;
		const workflow = units.find((unit) => unit.logicalName === 'test/app:verify.yml')!;

		expect(rules).toMatchObject({ unitType: 'github-branch-rules', dependencies: [environment.unitId] });
		expect(environment.dependencies).toEqual([branch.unitId]);
		expect(workflow).toMatchObject({
			unitType: 'github-workflow-observation',
			dependencies: [environment.unitId],
			spec: { repository: 'test/app', workflow: 'verify.yml', ref: 'staging' },
		});
	});

	it('binds production deployment policy and workflow observation to main', () => {
		const result = validateSeedSource(source.replace('environments: [local]', 'environments: [local, prod]'));
		const units = compileSeedRepositoryUnits(result.manifest!, 'prod');
		const environment = units.find((unit) => unit.unitType === 'github-environment' && unit.logicalName === 'test/app:production')!;
		const workflow = units.find((unit) => unit.logicalName === 'test/app:verify.yml')!;

		expect(environment.spec).toMatchObject({ environment: 'production', branch: 'main' });
		expect(workflow.spec).toMatchObject({ repository: 'test/app', workflow: 'verify.yml', ref: 'main' });
	});
});
