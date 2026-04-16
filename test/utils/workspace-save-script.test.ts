import { describe, expect, it } from 'vitest';
import type { TreeseedWorkflowResult } from '../../src/workflow.ts';
import { TreeseedWorkflowError } from '../../src/workflow/operations.ts';
import {
	formatWorkspaceSaveFailureReport,
	formatWorkspaceSaveSuccessReport,
	parseWorkspaceSaveScriptArgs,
} from '../../src/operations/services/workspace-save-script.ts';

describe('workspace-save script compatibility helpers', () => {
	it('parses the legacy hotfix flag and message tail', () => {
		expect(parseWorkspaceSaveScriptArgs(['--hotfix', 'fix:', 'unblock', 'deploy'])).toEqual({
			hotfix: true,
			message: 'fix: unblock deploy',
		});
	});

	it('serializes workflow save success reports from the workflow payload', () => {
		const result: TreeseedWorkflowResult<Record<string, unknown>> = {
			ok: true,
			operation: 'save',
			payload: {
				branch: 'feature/demo-task',
				scope: 'local',
				hotfix: false,
				commitSha: 'abc123def456',
				commitCreated: false,
				noChanges: true,
				branchSync: { pushed: true },
				previewAction: { status: 'skipped' },
				finalState: { branchName: 'feature/demo-task' },
			},
		};

		expect(formatWorkspaceSaveSuccessReport(result)).toMatchObject({
			ok: true,
			kind: 'success',
			operation: 'save',
			noChanges: true,
			commitCreated: false,
			branch: 'feature/demo-task',
		});
	});

	it('preserves workflow error codes and exit codes for compatibility', () => {
		const error = new TreeseedWorkflowError('save', 'merge_conflict', 'conflicts detected', {
			details: { branch: 'feature/demo-task' },
			exitCode: 12,
		});

		expect(formatWorkspaceSaveFailureReport(error)).toEqual({
			ok: false,
			kind: 'merge_conflict',
			operation: 'save',
			message: 'conflicts detected',
			details: { branch: 'feature/demo-task' },
			exitCode: 12,
		});
	});
});
