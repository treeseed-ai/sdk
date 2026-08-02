import { describe, expect, it, vi } from 'vitest';
import { syncLocalAcceptanceAgentClass,syncLocalAcceptanceAgentClasses } from '../../../../src/reconcile/capacity/capacity-core/live-acceptance-capacity-context.ts';

describe('live acceptance starter agent synchronization', () => {
	it('uses a globally unique project-scoped id while preserving the content class slug', async () => {
		const createProjectAgentClass = vi.fn(async (_projectId: string, body: Record<string, unknown>) => ({ payload: body }));
		const adminClient = {
			treeDxReadRepositoryFiles: vi.fn(async () => ({ payload: { resolvedRef: '0123456789abcdef0123456789abcdef01234567', files: [{
				path: 'template/src/content/agents/researcher.mdx',
				frontmatter: {
					projectAgentClassId: 'researcher', slug: 'researcher', name: 'Researcher',
					activityProfiles: { investigate: { activityType: 'planning' } },
				},
			}] } })),
			projectAgentClasses: vi.fn(async () => ({ payload: { items: [], page: { limit: 200, hasMore: false, nextCursor: null } } })),
			createProjectAgentClass,
			updateProjectAgentClass: vi.fn(),
		};

		const synchronized = await syncLocalAcceptanceAgentClasses(adminClient as never, {
			projectId: 'project-one', repositoryId: 'repository-one',
			agentPaths: ['template/src/content/agents/researcher.mdx'], runId: 'run-one',
		});

		expect(createProjectAgentClass).toHaveBeenCalledWith('project-one', expect.objectContaining({
			id: 'project-one:researcher', slug: 'researcher',
		}), 'capacity-acceptance:run-one:project-one:agent-class-create:researcher');
		expect(synchronized.resolvedRef).toBe('0123456789abcdef0123456789abcdef01234567');
	});

	it('scopes the runtime testing class id to its isolated project', async () => {
		const createProjectAgentClass = vi.fn(async (_projectId: string, body: Record<string, unknown>) => ({ payload: body }));
		const adminClient = {
			projectTreeDxLibrary: vi.fn(async () => ({ payload: { repositoryId: 'repository-one' } })),
			treeDxReadRepositoryFiles: vi.fn(async () => ({ payload: { files: [{
				path: 'src/content/agents/tester.mdx',
				frontmatter: { slug: 'tester', activityProfiles: { test: { activityType: 'planning' } }, identity: {} },
			}] } })),
			projectAgentClasses: vi.fn(async () => ({ payload: { items: [] } })),
			createProjectAgentClass,
			updateProjectAgentClass: vi.fn(),
		};

		const synchronized = await syncLocalAcceptanceAgentClass(adminClient as never, {
			projectId: 'project-two', agentClassId: 'testing', runId: 'run-two',
		});

		expect(createProjectAgentClass).toHaveBeenCalledWith('project-two', expect.objectContaining({
			id: 'project-two:testing', slug: 'testing',
		}), 'capacity-acceptance:run-two:agent-class-create');
		expect(synchronized.payload.id).toBe('project-two:testing');
	});
});
