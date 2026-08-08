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
		expect(units).toHaveLength(2);
		expect(units.map((unit) => unit.logicalName)).toEqual(['test/app', 'test/app-content']);
		expect(units.every((unit) => unit.unitType === 'github-repository' && unit.provider === 'github')).toBe(true);
		expect(units.find((unit) => unit.logicalName === 'test/app-content')?.metadata).toMatchObject({ repositoryRole: 'content' });
	});
});
