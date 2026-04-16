import type { TreeseedWorkflowResult } from '../../workflow.ts';
import { TreeseedWorkflowError } from '../../workflow/operations.ts';

export type SaveScriptArgs = {
	hotfix: boolean;
	message: string;
};

export function parseWorkspaceSaveScriptArgs(argv: string[]): SaveScriptArgs {
	const parsed = {
		hotfix: false,
		messageParts: [] as string[],
	};

	for (const current of argv) {
		if (current === '--hotfix') {
			parsed.hotfix = true;
			continue;
		}
		parsed.messageParts.push(current);
	}

	return {
		hotfix: parsed.hotfix,
		message: parsed.messageParts.join(' ').trim(),
	};
}

export function formatWorkspaceSaveSuccessReport(result: TreeseedWorkflowResult<Record<string, unknown>>) {
	return {
		ok: true,
		kind: 'success',
		operation: result.operation,
		...result.payload,
	};
}

export function formatWorkspaceSaveFailureReport(error: unknown) {
	if (error instanceof TreeseedWorkflowError) {
		return {
			ok: false,
			kind: error.code,
			operation: error.operation,
			message: error.message,
			details: error.details ?? null,
			exitCode: error.exitCode ?? 1,
		};
	}

	return {
		ok: false,
		kind: 'unsupported_state',
		operation: 'save',
		message: error instanceof Error ? error.message : String(error),
		exitCode: 1,
	};
}
