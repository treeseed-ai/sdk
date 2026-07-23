import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { TreeseedWorkflowMode } from '../session.ts';
import { TreeseedWorkflowGateCacheEntry, TreeseedWorkflowRunClassification, TreeseedWorkflowRunJournal, nowIso } from './treeseed-workflow-run-command.ts';
import { readWorkflowRunJournal, writeWorkflowRunJournal } from './ensure-workflow-exclude-rule.ts';
import { listWorkflowRunJournals } from './get-cached-successful-workflow-gate.ts';

export function updateWorkflowRunJournal(
	root: string,
	runId: string,
	updater: (journal: TreeseedWorkflowRunJournal) => TreeseedWorkflowRunJournal,
) {
	const current = readWorkflowRunJournal(root, runId);
	if (!current) {
		return null;
	}
	const updated = updater(current);
	writeWorkflowRunJournal(root, {
		...updated,
		updatedAt: nowIso(),
	});
	return readWorkflowRunJournal(root, runId);
}

export function stringRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

export function journalReleasePlanHead(plan: Record<string, unknown>, repoName: string) {
	if (repoName === '@treeseed/market') {
		const rootRepo = stringRecord(plan.rootRepo);
		return typeof rootRepo?.commitSha === 'string' ? rootRepo.commitSha : null;
	}
	const repos = Array.isArray(plan.repos) ? plan.repos : [];
	for (const repo of repos) {
		const record = stringRecord(repo);
		if (record?.name === repoName) {
			return typeof record.commitSha === 'string' ? record.commitSha : null;
		}
	}
	return null;
}

export function selectedReleasePackageNames(plan: Record<string, unknown>) {
	const selection = stringRecord(plan.packageSelection);
	const selected = Array.isArray(selection?.selected)
		? selection.selected.filter((name): name is string => typeof name === 'string')
		: [];
	return selected;
}

export function isReleaseGateOnlyCompletion(journal: TreeseedWorkflowRunJournal) {
	if (journal.command !== 'release') return false;
	const releaseRoot = journal.steps.find((step) => step.id === 'release-root');
	if (releaseRoot?.status !== 'completed') return false;
	const releaseRootData = stringRecord(releaseRoot.data);
	if (typeof releaseRootData?.releasedCommit !== 'string') return false;
	const pendingStep = journal.steps.find((step) => step.status === 'pending');
	return pendingStep?.id === 'release-root-gates'
		|| pendingStep?.id === 'release-back-merge';
}

export function releaseStepData(journal: TreeseedWorkflowRunJournal, stepId: string) {
	return stringRecord(journal.steps.find((step) => step.id === stepId)?.data);
}

export function expectedPackageHeadAfterReleaseGate(journal: TreeseedWorkflowRunJournal, packageName: string) {
	const data = releaseStepData(journal, `release-${packageName}`);
	const backMerge = stringRecord(data?.backMerge);
	if (typeof backMerge?.commitSha === 'string') return backMerge.commitSha;
	const commit = stringRecord(data?.commit);
	if (typeof commit?.commitSha === 'string') return commit.commitSha;
	if (typeof data?.commitSha === 'string') return data.commitSha;
	return null;
}

export function savePartialFailureData(journal: TreeseedWorkflowRunJournal) {
	const details = stringRecord(journal.failure?.details);
	return stringRecord(details?.partialFailure);
}

export function collectSaveExpectedHeads(journal: TreeseedWorkflowRunJournal) {
	const heads: Record<string, string> = {};
	const saveData = stringRecord(journal.steps.find((step) => step.id === 'save-repositories')?.data);
	const partialFailure = savePartialFailureData(journal);
	const source = saveData ?? partialFailure;
	const partial = saveData == null && partialFailure != null;
	const failingRepo = partial && typeof partialFailure?.failingRepo === 'string' ? partialFailure.failingRepo : null;
	const rootRepo = stringRecord(source?.rootRepo);
	const rootCompletionUnknown = rootRepo?.pushed == null && rootRepo?.committed == null;
	if (typeof rootRepo?.commitSha === 'string'
		&& (!partial || rootRepo.pushed === true || rootRepo.committed === true || (rootCompletionUnknown && rootRepo.dirty !== true))) {
		heads['@treeseed/market'] = rootRepo.commitSha;
	}
	const repos = Array.isArray(source?.repos) ? source.repos : [];
	for (const entry of repos) {
		const repo = stringRecord(entry);
		const completionUnknown = repo?.pushed == null && repo?.committed == null;
		if (typeof repo?.name === 'string'
			&& typeof repo.commitSha === 'string'
			&& (!partial || repo.pushed === true || repo.committed === true || (completionUnknown && repo.name !== failingRepo && repo.dirty !== true))) {
			heads[repo.name] = repo.commitSha;
		}
	}
	return heads;
}

export function collectStageExpectedHeads(journal: TreeseedWorkflowRunJournal) {
	const heads: Record<string, string> = {};
	const promotion = stringRecord(journal.steps.find((step) => step.id === 'promote-to-staging')?.data);
	const results = Array.isArray(promotion?.results) ? promotion.results : [];
	for (const entry of results) {
		const repo = stringRecord(entry);
		if (typeof repo?.name === 'string' && typeof repo.commitSha === 'string' && repo.verified === true) {
			heads[repo.name] = repo.commitSha;
		}
	}
	return heads;
}

export function classifyWorkflowRunJournal(
	journal: TreeseedWorkflowRunJournal,
	options: {
		currentBranch?: string | null;
		currentHeads?: Record<string, string | null | undefined>;
		acceptedReleaseHeads?: Record<string, string | null | undefined>;
		now?: string;
	} = {},
): TreeseedWorkflowRunClassification {
	const reasons: string[] = [];
	const now = options.now ?? nowIso();
	if (journal.classification?.archivedAt) {
		return {
			state: 'obsolete',
			reasons: journal.classification.reasons.length > 0 ? journal.classification.reasons : ['workflow run was archived'],
			classifiedAt: now,
			archivedAt: journal.classification.archivedAt,
		};
	}
	if (journal.status !== 'failed') {
		return {
			state: 'obsolete',
			reasons: [`workflow run status is ${journal.status}`],
			classifiedAt: now,
		};
	}
	const recovery = stringRecord(stringRecord(journal.failure)?.details)?.recovery;
	const recoveryRecord = stringRecord(recovery);
	const recoveryMarkedResumable = recoveryRecord?.resumable === true;
	if (!journal.resumable && !recoveryMarkedResumable) {
		return {
			state: 'obsolete',
			reasons: ['workflow run is not marked resumable'],
			classifiedAt: now,
		};
	}
	if (journal.command === 'switch' && journal.steps.every((step) => step.status === 'pending')) {
		return {
			state: 'obsolete',
			reasons: ['switch failed before completing any checkout step; rerun switch instead'],
			classifiedAt: now,
		};
	}
	if (options.currentBranch && journal.session.branchName && options.currentBranch !== journal.session.branchName) {
		reasons.push(`current branch ${options.currentBranch} does not match journal branch ${journal.session.branchName}`);
	}
	const releaseGateOnlyCompletion = isReleaseGateOnlyCompletion(journal);
	if (journal.command === 'release' && options.currentHeads && releaseGateOnlyCompletion) {
		const rootRelease = releaseStepData(journal, 'release-root');
		const expectedRootHead = typeof rootRelease?.stagingCommit === 'string' ? rootRelease.stagingCommit : null;
		const rootHead = options.currentHeads['@treeseed/market'];
		if (rootHead && expectedRootHead && rootHead !== expectedRootHead) {
			reasons.push(`market staging head changed from ${expectedRootHead} to ${rootHead}`);
		}
		const releasePlan = releaseStepData(journal, 'release-plan');
		for (const name of selectedReleasePackageNames(releasePlan)) {
			const currentHead = options.currentHeads[name];
			const expectedHead = expectedPackageHeadAfterReleaseGate(journal, name);
			if (currentHead && expectedHead && currentHead !== expectedHead) {
				reasons.push(`${name} staging head changed from ${expectedHead} to ${currentHead}`);
			}
		}
	}
	if (journal.command === 'release' && options.currentHeads && !releaseGateOnlyCompletion) {
		const releasePlan = stringRecord(journal.steps.find((step) => step.id === 'release-plan')?.data);
		if (releasePlan) {
			const rootHead = options.currentHeads['@treeseed/market'];
			const plannedRootHead = journalReleasePlanHead(releasePlan, '@treeseed/market');
			if (rootHead && plannedRootHead && rootHead !== plannedRootHead) {
				reasons.push(`market head changed from ${plannedRootHead} to ${rootHead}`);
			}
			for (const name of selectedReleasePackageNames(releasePlan)) {
				const currentHead = options.currentHeads[name];
				const expectedHead = expectedPackageHeadAfterReleaseGate(journal, name)
					?? options.acceptedReleaseHeads?.[name]
					?? journalReleasePlanHead(releasePlan, name);
				if (currentHead && expectedHead && currentHead !== expectedHead) {
					reasons.push(`${name} head changed from ${expectedHead} to ${currentHead}`);
				}
			}
		}
	}
	if (journal.command === 'save' && options.currentHeads) {
		const expectedHeads = collectSaveExpectedHeads(journal);
		for (const [name, expectedHead] of Object.entries(expectedHeads)) {
			const currentHead = options.currentHeads[name];
			if (currentHead && expectedHead && currentHead !== expectedHead) {
				reasons.push(`${name} head changed from ${expectedHead} to ${currentHead}`);
			}
		}
	}
	if (journal.command === 'stage' && options.currentHeads) {
		const expectedHeads = collectStageExpectedHeads(journal);
		for (const [name, expectedHead] of Object.entries(expectedHeads)) {
			const currentHead = options.currentHeads[name];
			if (currentHead && currentHead !== expectedHead) {
				reasons.push(`${name} head changed from staged candidate ${expectedHead} to ${currentHead}`);
			}
		}
	}
	return {
		state: reasons.length > 0 ? 'stale' : 'resumable',
		reasons: reasons.length > 0
			? reasons
			: releaseGateOnlyCompletion
				? ['release commits already exist; remaining release gates can be rechecked']
				: ['workflow run can be resumed'],
		classifiedAt: now,
	};
}

export function classifyWorkflowRunJournals(
	root: string,
	options: Parameters<typeof classifyWorkflowRunJournal>[1] = {},
) {
	return listWorkflowRunJournals(root).map((journal) => ({
		journal,
		classification: classifyWorkflowRunJournal(journal, options),
	}));
}

export function archiveWorkflowRun(root: string, runId: string, classification: TreeseedWorkflowRunClassification) {
	const archivedAt = nowIso();
	return updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		resumable: false,
		classification: {
			...classification,
			state: classification.state === 'resumable' ? 'stale' : classification.state,
			archivedAt,
			classifiedAt: archivedAt,
		},
	}));
}

export function gateCacheMatches(entry: TreeseedWorkflowGateCacheEntry, gate: {
	repository?: string | null;
	workflow: string;
	headSha: string;
	branch?: string | null;
}) {
	return entry.workflow === gate.workflow
		&& entry.headSha === gate.headSha
		&& (gate.repository == null || entry.repo === gate.repository)
		&& (gate.branch == null || entry.branch === gate.branch);
}
