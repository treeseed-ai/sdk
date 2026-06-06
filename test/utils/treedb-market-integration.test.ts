import { describe, expect, it } from 'vitest';
import {
	assertCapacityProviderPortfolioManifest,
	buildManagedTreeDbInstance,
	buildProjectRepositoryTopology,
	isTreeDbCanonicalContent,
	normalizeProjectRepositoryTopology,
	normalizeTemplateLaunchRequirements,
} from '../../src/index.ts';

describe('TreeDB market integration contracts', () => {
	it('accepts knowledge-library template host requirements', () => {
		const requirements = normalizeTemplateLaunchRequirements({
			hosts: [{
				kind: 'host',
				key: 'knowledgeLibrary',
				type: 'knowledge-library',
				required: true,
				compatibleProviders: ['treedb'],
				displayName: 'Knowledge Library',
				purpose: 'Stores project content in TreeDB.',
				configWrites: [],
			}],
		});

		expect(requirements?.hosts?.[0]?.type).toBe('knowledge-library');
	});

	it('normalizes TreeDB content with filesystem site and project repositories', () => {
		const instance = buildManagedTreeDbInstance({
			id: 'treedb_team',
			teamId: 'team_123',
			teamSlug: 'acme',
			baseUrl: 'https://treedb.acme.example',
		});
		const topology = buildProjectRepositoryTopology({
			instance,
			binding: {
				id: 'binding_1',
				teamId: 'team_123',
				projectId: 'project_123',
				instanceId: instance.id,
				libraryId: 'acme/docs',
				contentPath: 'src/content',
				contentRepositoryUrl: 'https://github.com/acme/docs-content',
				contentRepositoryDefaultBranch: 'main',
			},
			siteRepository: {
				url: 'https://github.com/acme/docs-site',
				checkoutPath: '/data/projects/docs/site',
				volumePath: '/data/projects/docs/site',
			},
			projectRepository: {
				url: 'https://github.com/acme/software',
				checkoutPath: '/data/projects/docs/project',
				siteSubmodulePath: 'docs',
			},
		});

		const normalized = normalizeProjectRepositoryTopology(topology);
		expect(isTreeDbCanonicalContent(normalized)).toBe(true);
		expect(normalized.contentRepository.accessMode).toBe('treedb');
		expect(normalized.siteRepository.accessMode).toBe('filesystem');
		expect(normalized.projectRepository?.accessMode).toBe('filesystem');
	});

	it('validates capacity provider repository topology access modes', () => {
		const topology = normalizeProjectRepositoryTopology({
			contentRepository: {
				accessMode: 'treedb',
				contentPath: 'src/content',
				treeDb: { instanceId: 'treedb_team', libraryId: 'team/project' },
			},
			siteRepository: { accessMode: 'filesystem', name: 'site' },
			projectRepository: { accessMode: 'filesystem', name: 'project' },
		});

		expect(() => assertCapacityProviderPortfolioManifest({
			team: { id: 'team_123', slug: 'team', name: 'Team' },
			projects: [{
				id: 'project_123',
				slug: 'project',
				name: 'Project',
				repository: {
					provider: 'github',
					owner: 'team',
					name: 'project-site',
					defaultBranch: 'staging',
					cloneUrl: 'https://github.com/team/project-site',
				},
				repositoryTopology: topology,
				agentSpecs: { root: 'src/content/agents', testsRoot: 'src/content/agent-tests' },
				workPolicy: { enabled: true },
			}],
		})).not.toThrow();
	});
});
