import type { TreeseedDeployConfig } from ".././platform/contracts.ts";
import { TreeseedWorkflowState, runGit } from './treeseed-branch-role.ts';

export function safeReleaseHistory(repoDir: string | null): TreeseedWorkflowState['releaseHistory'] {
	if (!repoDir) {
		return {
			stagingAheadMain: null,
			stagingBehindMain: null,
			unreleasedStagingCommits: null,
			backMerged: null,
			detail: 'Repository root is unavailable.',
		};
	}
	try {
		const output = runGit(['rev-list', '--left-right', '--count', 'staging...main'], { cwd: repoDir, capture: true }).trim();
		const [aheadRaw, behindRaw] = output.split(/\s+/u);
		const stagingAheadMain = Number.parseInt(aheadRaw ?? '', 10);
		const stagingBehindMain = Number.parseInt(behindRaw ?? '', 10);
		if (!Number.isFinite(stagingAheadMain) || !Number.isFinite(stagingBehindMain)) {
			throw new Error('invalid rev-list output');
		}
		const stagingOnlySubjects = runGit(['log', '--format=%s', 'main..staging'], { cwd: repoDir, capture: true })
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
		const unreleasedStagingCommits = stagingOnlySubjects
			.filter((subject) =>
				subject !== 'release: sync package staging heads'
				&& subject !== 'release: back-merge main into staging'
				&& !subject.startsWith('release: back-merge main into staging '))
			.length;
		return {
			stagingAheadMain,
			stagingBehindMain,
			unreleasedStagingCommits,
			backMerged: stagingBehindMain === 0,
			detail: stagingBehindMain === 0 && unreleasedStagingCommits === 0
				? (stagingAheadMain > 0
					? 'Staging contains current main release history and is only ahead by release sync commits.'
					: 'Staging contains current main release history.')
				: stagingBehindMain === 0
					? `Staging has ${unreleasedStagingCommits} unreleased commit${unreleasedStagingCommits === 1 ? '' : 's'} and contains current main release history.`
				: `Staging is missing ${stagingBehindMain} main commit${stagingBehindMain === 1 ? '' : 's'}.`,
		};
	} catch {
		return {
			stagingAheadMain: null,
			stagingBehindMain: null,
			unreleasedStagingCommits: null,
			backMerged: null,
			detail: 'Could not compare staging and main release history.',
		};
	}
}

export const DEFAULT_WORKFLOW_RUN_HISTORY_LIMIT = 20;

export function capWorkflowRunHistory<T>(
	runs: T[],
	options: { history?: 'recent' | 'all'; limit?: number } = {},
) {
	const historyMode = options.history === 'all' ? 'all' : 'recent';
	const limit = options.limit ?? DEFAULT_WORKFLOW_RUN_HISTORY_LIMIT;
	const total = runs.length;
	if (historyMode === 'all') {
		return {
			historyMode,
			runs,
			total,
			omitted: 0,
		};
	}
	const cappedRuns = runs.slice(0, limit);
	return {
		historyMode,
		runs: cappedRuns,
		total,
		omitted: Math.max(0, total - cappedRuns.length),
	};
}

export function capObsoleteWorkflowRuns<T>(
	obsoleteRuns: T[],
	options: { history?: 'recent' | 'all'; limit?: number } = {},
) {
	const capped = capWorkflowRunHistory(obsoleteRuns, options);
	return {
		historyMode: capped.historyMode,
		obsoleteRuns: capped.runs,
		obsoleteRunsTotal: capped.total,
		obsoleteRunsOmitted: capped.omitted,
	};
}

export function resolveLocalStatusUrl(deployConfig: TreeseedDeployConfig) {
	return deployConfig.surfaces?.web?.localBaseUrl
		?? deployConfig.surfaces?.api?.localBaseUrl
		?? Object.values(deployConfig.services ?? {})
			.find((service) => service?.enabled !== false && service.environments?.local?.baseUrl)
			?.environments?.local?.baseUrl
		?? null;
}
