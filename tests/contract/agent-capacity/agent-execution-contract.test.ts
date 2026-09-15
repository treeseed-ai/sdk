import { describe, expect, it } from 'vitest';
import {
	assignmentContextSchema,
	assignmentResultSchema,
	assignmentWorkspaceSchema,
	exactEntityReferenceSchema,
} from '../../../src/agent-capacity/contracts/capacity/assignments/agent-execution.ts';

const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;

describe('canonical agent execution contract', () => {
	it('accepts exactly the three workspace modes and one mutable workspace', () => {
		expect(assignmentWorkspaceSchema.parse({ mode: 'read-only' })).toEqual({ mode: 'read-only' });
		expect(assignmentWorkspaceSchema.parse({ mode: 'git', repository: 'treeseed-ai/sdk', baseCommit: sha, branch: 'assignment/one', writablePaths: ['src'] }).mode).toBe('git');
		expect(assignmentWorkspaceSchema.parse({ mode: 'treedx', workspaceId: 'workspace-1', repository: 'treeseed-ai/sdk-library', baseCommit: sha, writablePaths: ['knowledge'] }).mode).toBe('treedx');
		expect(() => assignmentWorkspaceSchema.parse({ mode: 'git', repository: 'sdk', baseCommit: sha, branch: 'work', writablePaths: ['src'], treeDxWorkspaceId: 'also-write' })).toThrow();
	});

	it('requires exact store-specific entity references', () => {
		expect(exactEntityReferenceSchema.safeParse({ store: 'git', model: 'source', id: 'sdk', repository: 'treeseed-ai/sdk', commit: sha, path: 'src' }).success).toBe(true);
		expect(exactEntityReferenceSchema.safeParse({ store: 'git', model: 'source', id: 'sdk' }).success).toBe(false);
		expect(exactEntityReferenceSchema.safeParse({ store: 'treedx', model: 'knowledge', id: 'architecture', revision: 2, digest }).success).toBe(true);
	});

	it('rejects handler-specific output taxonomies from the one shared result', () => {
		const result = {
			schemaVersion: 'treeseed.assignment-result/v1', id: 'result-1', assignmentId: 'assignment-1', status: 'completed',
			summary: 'Completed the assignment.', references: [], verification: [], usage: { elapsedSeconds: 1 }, diagnostics: [],
			completedAt: '2026-09-13T12:00:00.000Z', specializedOutput: { commit: sha },
		};
		expect(assignmentResultSchema.safeParse(result).success).toBe(false);
		delete (result as { specializedOutput?: unknown }).specializedOutput;
		expect(assignmentResultSchema.safeParse(result).success).toBe(true);
	});

	it('does not allow context to restate assignment authority', () => {
		const parsed = assignmentContextSchema.safeParse({ assignment: {}, context: [], predecessorResults: [], grant: {} });
		expect(parsed.success).toBe(false);
		if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
	});
});
