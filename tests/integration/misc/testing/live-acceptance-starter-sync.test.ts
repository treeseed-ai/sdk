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
			handlerRefs: expect.objectContaining({ agents: [expect.objectContaining({
				slug: 'researcher', contentPath: 'template/src/content/agents/researcher.mdx',
			})] }),
		}), expect.stringMatching(/^capacity-acceptance:run-one:project-one:agent-class-create:researcher:[a-f0-9]{16}$/u));
		expect(synchronized.resolvedRef).toBe('0123456789abcdef0123456789abcdef01234567');
	});

	it('freezes portable authority from the raw immutable definition when the TreeDX projection is incomplete', async () => {
		const createProjectAgentClass = vi.fn(async (_projectId: string, body: Record<string, unknown>) => ({ payload: body }));
		const content = `---
projectAgentClassId: researcher
slug: researcher
name: Researcher
groupIds: [editorial-team, research]
contextQuerySetRefs:
  - id: guide-work
    revision: 2
instructionTemplateRefs:
  - id: assignment-plan
    revision: 1
activityProfiles:
  planning:
    activityType: planning
---
Research evidence.
`;
		const adminClient = {
			treeDxReadRepositoryFiles: vi.fn(async () => ({ payload: { resolvedRef: '0123456789abcdef0123456789abcdef01234567', files: [{
				path: 'src/content/agents/researcher.mdx', source: content,
				frontmatter: { projectAgentClassId: 'researcher', slug: 'researcher', name: 'Researcher', activityProfiles: { planning: { activityType: 'planning' } } },
			}] } })),
			projectAgentClasses: vi.fn(async () => ({ payload: { items: [], page: { limit: 200, hasMore: false, nextCursor: null } } })),
			createProjectAgentClass, updateProjectAgentClass: vi.fn(),
		};

		await syncLocalAcceptanceAgentClasses(adminClient as never, {
			projectId: 'project-one', repositoryId: 'repository-one', agentPaths: ['src/content/agents/researcher.mdx'], runId: 'run-one',
		});

		expect(createProjectAgentClass).toHaveBeenCalledWith('project-one', expect.objectContaining({
			handlerRefs: expect.objectContaining({ agents: [expect.objectContaining({
				groupIds: ['editorial-team', 'research'], contextQuerySetRefs: [{ id: 'guide-work', revision: 2 }],
				instructionTemplateRefs: [{ id: 'assignment-plan', revision: 1 }],
			})] }),
		}), expect.any(String));
		expect(adminClient.treeDxReadRepositoryFiles).toHaveBeenCalledWith('project-one', 'repository-one', expect.objectContaining({
			parseFrontmatter: false,
		}));
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
