import {
	createProofRecord,
	type TreeseedProofDriver,
	type TreeseedProofRecord,
} from './release-proof.ts';
import { spawnSync } from 'node:child_process';
import { maybeResolveGitHubRepositorySlug } from './github-automation.ts';
import { writeProofRecord } from './release-proof-ledger.ts';
import { buildTreeseedProofPlan, type TreeseedProofPlan, type TreeseedProofTarget } from './release-proof-planner.ts';
import { inspectGitHubActionsVerification } from './github-actions-verification.ts';

export type TreeseedProofRunResult = {
	plan: TreeseedProofPlan;
	records: TreeseedProofRecord[];
	reused: TreeseedProofRecord[];
	failures: TreeseedProofRecord[];
	ok: boolean;
};

function workflowRecordFromInspection(input: {
	root: string;
	subject: TreeseedProofPlan['subjects'][number];
	workflow: Awaited<ReturnType<typeof inspectGitHubActionsVerification>>['repositories'][number]['workflows'][number] | null;
	startedAt: string;
	status: TreeseedProofRecord['status'];
}) {
	const finishedAt = new Date().toISOString();
	return createProofRecord({
		subject: input.subject.subject,
		inputs: input.subject.inputs,
		driver: input.subject.driver,
		status: input.status,
		startedAt: input.startedAt,
		finishedAt,
		reusable: input.status === 'passed',
		invalidationReasons: input.status === 'passed' ? [] : [input.workflow?.message ?? 'Hosted GitHub workflow did not pass.'],
		result: input.workflow && input.subject.subject.repository ? {
			workflow: {
				repository: input.subject.subject.repository,
				workflow: input.workflow.workflow,
				runId: input.workflow.runId,
				url: input.workflow.url,
				conclusion: input.workflow.conclusion,
				failedJobs: input.workflow.failedJobs.map((job) => ({
					id: job.id,
					name: job.name,
					url: job.url,
					failedSteps: job.failedSteps.map((step) => step.name),
					...(job.logExcerpt ? { logExcerpt: job.logExcerpt } : {}),
				})),
			},
		} : {},
	});
}

async function runHostedProof(root: string, subject: TreeseedProofPlan['subjects'][number]) {
	const startedAt = new Date().toISOString();
	if (!subject.subject.repository && maybeResolveGitHubRepositorySlug(subject.subject.repoPath) == null) {
		return createProofRecord({
			subject: subject.subject,
			inputs: subject.inputs,
			driver: subject.driver,
			status: 'skipped',
			startedAt,
			reusable: false,
			invalidationReasons: ['Proof subject is not backed by a GitHub repository in this local test workspace.'],
		});
	}
	if (!subject.subject.repository || !subject.subject.branch || !subject.subject.headSha || !subject.workflow) {
		return createProofRecord({
			subject: subject.subject,
			inputs: subject.inputs,
			driver: subject.driver,
			status: 'blocked',
			startedAt,
			reusable: false,
			invalidationReasons: ['Repository, branch, head SHA, or workflow is unavailable for hosted proof.'],
		});
	}
	const report = await inspectGitHubActionsVerification([{
		name: subject.subject.name,
		repoPath: subject.subject.repoPath,
		repository: subject.subject.repository,
		branch: subject.subject.branch,
		headSha: subject.subject.headSha,
		workflows: [subject.workflow],
		kind: subject.subject.kind === 'root' ? 'root' : 'package',
		missingIsFailure: true,
	}], {
		includeLogs: true,
		logLines: 120,
	});
	const workflow = report.repositories[0]?.workflows[0] ?? null;
	const status: TreeseedProofRecord['status'] = workflow?.state === 'success'
		? 'passed'
		: workflow?.state === 'pending' ? 'pending' : 'failed';
	return workflowRecordFromInspection({ root, subject, workflow, startedAt, status });
}

function advisorySkippedProof(subject: TreeseedProofPlan['subjects'][number]) {
	const now = new Date().toISOString();
	return createProofRecord({
		subject: subject.subject,
		inputs: subject.inputs,
		driver: subject.driver,
		status: 'skipped',
		startedAt: now,
		finishedAt: now,
		reusable: false,
		invalidationReasons: [
			subject.driver === 'act'
				? 'Local action simulation is advisory and cannot satisfy authoritative hosted proof.'
				: 'Only github-hosted proof execution is enabled for this proof runner slice.',
		],
		result: subject.command ? {
			command: { command: subject.command, cwd: subject.subject.repoPath, exitCode: null },
		} : {},
	});
}

function runLocalProof(subject: TreeseedProofPlan['subjects'][number]) {
	const startedAt = new Date().toISOString();
	if (!subject.commandSpec) {
		return createProofRecord({
			subject: subject.subject,
			inputs: subject.inputs,
			driver: subject.driver,
			status: 'blocked',
			startedAt,
			reusable: false,
			invalidationReasons: ['No local proof command is declared for this subject.'],
		});
	}
	const result = spawnSync(subject.commandSpec.command, subject.commandSpec.args, {
		cwd: subject.commandSpec.cwd || subject.subject.repoPath,
		env: {
			...process.env,
			TREESEED_VERIFY_DRIVER: 'direct',
			TMPDIR: process.env.TMPDIR ?? '/tmp',
		},
		stdio: 'inherit',
		shell: false,
	});
	const finishedAt = new Date().toISOString();
	const exitCode = typeof result.status === 'number' ? result.status : null;
	const errorMessage = result.error instanceof Error ? result.error.message : null;
	return createProofRecord({
		subject: subject.subject,
		inputs: subject.inputs,
		driver: subject.driver,
		status: exitCode === 0 ? 'passed' : 'failed',
		startedAt,
		finishedAt,
		reusable: exitCode === 0,
		invalidationReasons: exitCode === 0 ? [] : [`Local proof command failed${errorMessage ? `: ${errorMessage}` : exitCode == null ? '.' : ` with exit code ${exitCode}.`}`],
		result: {
			command: {
				command: [subject.commandSpec.command, ...subject.commandSpec.args].join(' '),
				cwd: subject.commandSpec.cwd || subject.subject.repoPath,
				exitCode,
			},
		},
	});
}

export async function runTreeseedProof(input: {
	root: string;
	target?: TreeseedProofTarget;
	driver?: TreeseedProofDriver;
	subject?: string | null;
	write?: (line: string, stream?: 'stdout' | 'stderr') => void;
}): Promise<TreeseedProofRunResult> {
	const plan = buildTreeseedProofPlan(input);
	const records: TreeseedProofRecord[] = [];
	const reused: TreeseedProofRecord[] = [];
	for (const subject of plan.subjects) {
		if (subject.reusableProof) {
			reused.push(subject.reusableProof);
			continue;
		}
		input.write?.(`[proof] Proving ${subject.subject.id} with ${subject.driver}${subject.workflow ? ` (${subject.workflow})` : ''}.`);
		const record = subject.driver === 'github-hosted'
			? await runHostedProof(input.root, subject)
			: subject.driver === 'local'
				? runLocalProof(subject)
			: advisorySkippedProof(subject);
		writeProofRecord(input.root, record);
		records.push(record);
		if (record.status === 'failed' || record.status === 'blocked') {
			break;
		}
	}
	const failures = [...records, ...reused].filter((record) => record.status === 'failed' || record.status === 'blocked' || (record.driver === 'github-hosted' && record.status === 'pending'));
	return {
		plan,
		records,
		reused,
		failures,
		ok: failures.length === 0 && records.every((record) => record.status === 'passed' || record.status === 'skipped'),
	};
}
