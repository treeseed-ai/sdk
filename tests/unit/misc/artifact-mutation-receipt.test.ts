import { describe,expect,it } from 'vitest';
import { validateArtifactMutationReceipt } from '../../../src/agent-capacity/artifact-mutation-receipt.ts';

const receipt = {
	schemaVersion: 'treeseed.artifact-mutation-receipt/v1' as const,
	id: 'assignment-1:mutation:source:abc123', kind: 'source-checkpoint' as const, phase: 'provisional' as const,
	executionMode: 'production' as const, upstreamMutationPolicy: 'checkpoint-only' as const,
	assignmentId: 'assignment-1', modeRunId: 'mode-run-1', teamId: 'team-1', projectId: 'project-1',
	baseRef: '0123456789abcdef', effectiveRef: 'abc123def456', changedPaths: ['src/result.ts'],
	before: { ref: '0123456789abcdef', artifactRefs: [] },
	after: { ref: 'abc123def456', artifactRefs: ['repo://src/result.ts'] }, createdAt: '2026-08-13T12:00:00.000Z',
};

describe('artifact mutation receipt', () => {
	it('accepts exact before and after authority evidence', () => {
		expect(validateArtifactMutationReceipt(receipt)).toMatchObject({ ok: true, value: receipt });
	});

	it('rejects branch aliases and mismatched before evidence', () => {
		expect(validateArtifactMutationReceipt({ ...receipt, baseRef: 'main' })).toMatchObject({ ok: false, reason: expect.stringContaining('baseRef') });
		expect(validateArtifactMutationReceipt({ ...receipt, before: { ...receipt.before, ref: 'different' } })).toMatchObject({ ok: false, reason: expect.stringContaining('before.ref') });
	});
});
