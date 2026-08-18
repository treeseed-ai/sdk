import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { boundedWorkflowRunSummary } from '../../../../src/workflow/runs.ts';

const roots: string[] = [];

describe('large workflow journal recovery', () => {
	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	it('builds a fail-closed summary without parsing a large telemetry tail', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-large-workflow-run-'));
		roots.push(root);
		const path = join(root, 'save-large.json');
		const head = JSON.stringify({
			runId: 'save-large',
			command: 'save',
			executionMode: 'execute',
			status: 'failed',
			createdAt: '2026-08-02T12:00:00.000Z',
			updatedAt: '2026-08-02T12:30:00.000Z',
		});
		writeFileSync(path, `${head}\n${'telemetry'.repeat(700_000)}`, 'utf8');

		expect(boundedWorkflowRunSummary(path)).toMatchObject({
			runId: 'save-large',
			command: 'save',
			status: 'failed',
			resumable: false,
			failure: {
				code: 'bounded_recovery_summary',
			},
		});
	});
});
