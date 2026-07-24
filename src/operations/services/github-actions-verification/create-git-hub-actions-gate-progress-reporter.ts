import { Buffer } from 'node:buffer';
import {
	createGitHubApiClient,
	parseGitHubRepositorySlug,
	type GitHubApiClient,
	type GitHubWorkflowProgressEvent,
} from '../repositories/github-api.ts';
import { GitHubActionsWorkflowGate } from './git-hub-actions-workflow-state.ts';
import { formatCompactedGitHubActionsGateProgress, formatGitHubActionsGateProgress, progressCompactKey } from './inspect-target.ts';

export function createGitHubActionsGateProgressReporter(
	gate: GitHubActionsWorkflowGate,
	options: {
		operation?: string;
		now?: () => number;
		minRepeatMs?: number;
		onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
	} = {},
) {
	const operation = options.operation ?? 'workflow';
	const now = options.now ?? (() => Date.now());
	const minRepeatMs = options.minRepeatMs ?? 60_000;
	let lastKey: string | null = null;
	let lastChangeAt = now();
	let lastEmitAt = 0;
	let repeatedPolls = 0;
	return (event: GitHubWorkflowProgressEvent) => {
		if (event.type === 'completed') {
			options.onProgress?.(formatGitHubActionsGateProgress(gate, event, operation));
			lastKey = null;
			repeatedPolls = 0;
			lastEmitAt = now();
			lastChangeAt = lastEmitAt;
			return;
		}
		const currentKey = progressCompactKey(gate, event);
		const currentTime = now();
		if (currentKey !== lastKey) {
			lastKey = currentKey;
			lastChangeAt = currentTime;
			lastEmitAt = currentTime;
			repeatedPolls = 0;
			options.onProgress?.(formatGitHubActionsGateProgress(gate, event, operation));
			return;
		}
		repeatedPolls += 1;
		if (currentTime - lastEmitAt >= minRepeatMs) {
			options.onProgress?.(formatCompactedGitHubActionsGateProgress(
				gate,
				event,
				operation,
				repeatedPolls,
				Math.max(0, Math.round((currentTime - lastChangeAt) / 1000)),
			));
			lastEmitAt = currentTime;
			repeatedPolls = 0;
		}
	};
}

export async function waitForGitHubActionsGate(
	gate: GitHubActionsWorkflowGate,
	options: {
		timeoutSeconds?: number;
		pollSeconds?: number;
		operation?: string;
		env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
		onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
	} = {},
) {
	const { waitForGitHubWorkflowCompletion } = await import('../repositories/github-automation.ts');
	const reportProgress = createGitHubActionsGateProgressReporter(gate, {
		operation: options.operation ?? 'workflow',
		onProgress: options.onProgress,
	});
	return await waitForGitHubWorkflowCompletion(gate.repoPath, {
		repository: gate.repository,
		workflow: gate.workflow,
		headSha: gate.headSha,
		branch: gate.branch,
		timeoutSeconds: gate.timeoutSeconds ?? options.timeoutSeconds,
		pollSeconds: gate.pollSeconds ?? options.pollSeconds,
		dispatchIfMissing: gate.dispatchIfMissing ?? gate.workflow === 'verify.yml',
		dispatchAfterSeconds: gate.dispatchAfterSeconds ?? 75,
		dispatchInputs: gate.dispatchInputs,
		env: options.env,
		onProgress: reportProgress,
	}) as Record<string, unknown>;
}
