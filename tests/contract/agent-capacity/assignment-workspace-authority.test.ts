import { describe, expect, it } from 'vitest';
import { assignmentAttemptSchema } from '../../../src/agent-capacity/contracts/capacity/assignments/agent-execution.ts';
import { assignmentPathAllowed } from '../../../src/capacity/agents/agent-capacity.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const commit = 'b'.repeat(40);
const attempt = () => ({
	schemaVersion: 'treeseed.assignment-attempt/v1', id: 'assignment', idempotencyKey: 'assignment',
	teamId: 'team', projectId: 'project', workdayId: 'workday', nodeId: 'node', agentClass: 'engineer', nodeRevision: 1, graphRevision: 1,
	sourceRef: { store: 'treedx', model: 'proposal', id: 'proposal', revision: 1, digest },
	authorityRefs: [{ store: 'postgresql', model: 'decision', id: 'decision', revision: 1, digest }],
	effectiveProfile: { profileRef: { store: 'treedx', model: 'agent', id: 'agent', revision: 1, digest },
		activity: 'acting', handler: 'actor', handlerOrigin: 'agent-package', prompt: { system: 'Implement the assigned work item.' },
		permissionCeiling: { content: { read: [], write: [] }, tools: ['source.read', 'source.write'] } },
	requiredCapabilities: [],
	grant: { contentRead: [], contentWrite: [], sourceRead: ['treeseed-ai/sdk'], sourceWrite: ['treeseed-ai/sdk'], tools: ['source.read', 'source.write'] },
	provider: { providerId: 'provider', offerId: 'offer', executionProviderId: 'codex-implementation', modelConfigurationId: 'terra-medium',
		executionCapabilityId: 'code-change', offerRevision: 1, runtimeBuild: digest },
	contextRefs: [], predecessorResultIds: [], workspace: { mode: 'git', repository: 'treeseed-ai/sdk', baseCommit: commit,
		branch: 'treeseed/assignments/assignment', writablePaths: ['src'] },
	estimate: { expectedSeconds: 2, maximumSeconds: 3 },
	limits: { maximumSeconds: 3, maximumContextBytes: 1024, maximumContextItems: 1 },
	deadline: '2026-09-20T21:00:00.000Z', leaseId: 'lease', reservationId: 'reservation', attempt: 1,
	status: 'created', createdAt: '2026-09-20T20:00:00.000Z',
});

describe('one mutable assignment workspace', () => {
	it('accepts recursive discussion grants without granting sibling collections', () => {
		for (const path of ['discussion-messages/message.mdx', 'discussion-messages/topic/message.mdx']) {
			expect(assignmentPathAllowed(path, ['discussion-messages/**', 'discussion-events/**'])).toBe(true);
		}
		for (const path of ['knowledge/message.mdx', 'discussion-messages-other/message.mdx', '/discussion-messages/message.mdx',
			'discussion-messages/../knowledge/message.mdx', 'discussion-messages//message.mdx', 'discussion-messages/./message.mdx',
			'discussion-messages\\message.mdx', 'discussion-messages/\0message.mdx', 'discussion-messages/**']) {
			expect(assignmentPathAllowed(path, ['discussion-messages/**'])).toBe(false);
		}
	});
	it('preserves exact directory grants and rejects unsafe or unsupported grant patterns', () => {
		expect(assignmentPathAllowed('src/index.ts', ['src'])).toBe(true);
		expect(assignmentPathAllowed('src/index.ts', ['src/'])).toBe(true);
		expect(assignmentPathAllowed('src/index.ts', ['.'])).toBe(true);
		expect(assignmentPathAllowed('src/index.ts', ['**'])).toBe(true);
		for (const grant of ['../src', '/src', 'src/*', 'src/**/other', 'src\\']) {
			expect(assignmentPathAllowed('src/index.ts', [grant])).toBe(false);
		}
	});
	it('allows an exact Git writer', () => {
		const parsed = assignmentAttemptSchema.safeParse(attempt());
		expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
	});
	it('rejects TreeDX writes alongside a Git workspace', () => {
		const value = attempt();
		value.grant.contentWrite = [{ store: 'treedx', model: 'note', id: 'note', repository: 'treeseed-ai/sdk-library', commit }] as never;
		expect(assignmentAttemptSchema.safeParse(value).success).toBe(false);
	});
	it('rejects other source repositories', () => {
		const value = attempt(); value.grant.sourceWrite = ['treeseed-ai/api'];
		expect(assignmentAttemptSchema.safeParse(value).success).toBe(false);
	});
	it('rejects all mutation in a read-only workspace', () => {
		const value = attempt(); value.workspace = { mode: 'read-only' } as never;
		expect(assignmentAttemptSchema.safeParse(value).success).toBe(false);
	});
	it('rejects Git writes in a TreeDX workspace', () => {
		const value = attempt();
		value.workspace = { mode: 'treedx', repository: 'treeseed-ai/sdk-library', baseCommit: commit, workspaceId: 'workspace', writablePaths: ['notes'] } as never;
		expect(assignmentAttemptSchema.safeParse(value).success).toBe(false);
	});
});
