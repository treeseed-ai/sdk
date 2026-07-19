import { describe, expect, it } from 'vitest';
import {
	buildManagedTreeDxInstance,
	buildProjectRepositoryTopology,
	isTreeDxCanonicalContent,
	normalizeProjectRepositoryTopology,
	normalizeTemplateLaunchRequirements,
} from '../../src/index.ts';

describe('TreeDX market integration contracts', () => {
	it('accepts knowledge-library template host requirements', () => {
		const requirements = normalizeTemplateLaunchRequirements({
			hosts: [{
				kind: 'host',
				key: 'knowledgeLibrary',
				type: 'knowledge-library',
				required: true,
				compatibleProviders: ['treedx'],
				displayName: 'Knowledge Library',
				purpose: 'Stores project content in TreeDX.',
				configWrites: [],
			}],
		});

		expect(requirements?.hosts?.[0]?.type).toBe('knowledge-library');
	});

	it('normalizes TreeDX content with filesystem site and project repositories', () => {
		const instance = buildManagedTreeDxInstance({
			id: 'treedx_team',
			teamId: 'team_123',
			teamSlug: 'acme',
			baseUrl: 'https://treedx.acme.example',
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
		expect(isTreeDxCanonicalContent(normalized)).toBe(true);
		expect(normalized.contentRepository.accessMode).toBe('treedx');
		expect(normalized.siteRepository.accessMode).toBe('filesystem');
		expect(normalized.projectRepository?.accessMode).toBe('filesystem');
	});

});
