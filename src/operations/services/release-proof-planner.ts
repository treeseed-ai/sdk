import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { discoverTreeseedPackageAdapters, type TreeseedPackageAdapter } from './package-adapters.ts';
import { classifyTreeseedGitMode, runTreeseedGitText } from './git-runner.ts';
import {
	computeProofInputHash,
	type TreeseedProofDriver,
	type TreeseedProofInput,
	type TreeseedProofRecord,
	type TreeseedProofSubject,
} from './release-proof.ts';
import { findReusableProof, readProofLedger } from './release-proof-ledger.ts';

export type TreeseedProofTarget = 'local' | 'staging' | 'prod';
export type TreeseedProofPlanMode = 'plan' | 'run' | 'status' | 'failures' | 'explain';

export type TreeseedProofPlanSubject = TreeseedProofInput & {
	workflow: string | null;
	command: string | null;
	authority: 'authoritative' | 'advisory';
	reusableProof: TreeseedProofRecord | null;
	rerunReasons: string[];
};

export type TreeseedProofPlan = {
	target: TreeseedProofTarget;
	driver: TreeseedProofDriver;
	subjects: TreeseedProofPlanSubject[];
	summary: {
		subjects: number;
		reusable: number;
		pending: number;
	};
};

function runGit(args: string[], cwd: string) {
	try {
		return runTreeseedGitText(args, {
			cwd,
			mode: classifyTreeseedGitMode(args),
			timeoutMs: 120000,
			maxBuffer: 1024 * 1024 * 8,
		}).trim();
	} catch {
		return null;
	}
}

function fileSha256(filePath: string) {
	if (!existsSync(filePath)) return null;
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function repositoryFor(adapter: TreeseedPackageAdapter) {
	const repository = adapter.metadata.repository;
	if (typeof repository === 'string' && repository.trim()) return repository.trim();
	if (repository && typeof repository === 'object' && !Array.isArray(repository)) {
		const url = (repository as Record<string, unknown>).url;
		if (typeof url === 'string') {
			return url
				.replace(/^git\+/u, '')
				.replace(/^ssh:\/\/git@github\.com[:/]/u, '')
				.replace(/^git@github\.com:/u, '')
				.replace(/^https:\/\/github\.com\//u, '')
				.replace(/\.git$/u, '')
				.replace(/\/$/u, '');
		}
	}
	return null;
}

export function hostedWorkflowForPackage(adapter: TreeseedPackageAdapter) {
	const configured = adapter.metadata.hostedVerifyWorkflow;
	if (typeof configured === 'string' && configured.trim()) return configured.trim().replace(/^\.github\/workflows\//u, '');
	const workflowCheck = adapter.releaseChecks.find((check) => check.kind === 'github-workflow');
	if (workflowCheck?.detail) return basename(workflowCheck.detail);
	if (adapter.id === 'treedx' || adapter.kind === 'beam-elixir-rust') return 'release-gate.yml';
	return 'verify.yml';
}

function commandForPackage(adapter: TreeseedPackageAdapter, driver: TreeseedProofDriver) {
	if (driver === 'act') return adapter.verifyCommands.local ? 'npm run verify:action' : null;
	const command = adapter.verifyCommands.release ?? adapter.verifyCommands.local ?? adapter.verifyCommands.fast;
	return command ? [command.command, ...command.args].join(' ') : null;
}

function subjectForPackage(adapter: TreeseedPackageAdapter): TreeseedProofSubject {
	return {
		kind: 'package',
		id: `package:${adapter.id}`,
		name: adapter.id,
		repoPath: adapter.dir,
		repository: repositoryFor(adapter),
		branch: runGit(['branch', '--show-current'], adapter.dir),
		headSha: runGit(['rev-parse', 'HEAD'], adapter.dir),
	};
}

function proofInputForPackage(root: string, adapter: TreeseedPackageAdapter, driver: TreeseedProofDriver, dependencyProofIds: string[]): TreeseedProofInput {
	const workflow = hostedWorkflowForPackage(adapter);
	const dockerfile = adapter.artifacts.find((artifact) => artifact.dockerfile)?.dockerfile;
	const sourceHashes = {
		head: runGit(['rev-parse', 'HEAD'], adapter.dir),
	};
	const baseInputs = {
		topologyHash: computeProofInputHash({
			packageId: adapter.id,
			kind: adapter.kind,
			workflow,
			command: commandForPackage(adapter, driver),
			artifacts: adapter.artifacts,
			dependencyProofIds,
		}),
		packageJsonHash: fileSha256(resolve(adapter.dir, 'package.json')),
		lockfileHash: adapter.kind === 'node-typescript'
			? fileSha256(resolve(adapter.dir, 'package-lock.json'))
			: (fileSha256(resolve(adapter.dir, 'Cargo.lock')) ?? fileSha256(resolve(adapter.dir, 'mix.lock'))),
		manifestHash: fileSha256(adapter.manifestPath ?? resolve(adapter.dir, 'treeseed.package.yaml')),
		workflowHash: fileSha256(resolve(adapter.dir, '.github', 'workflows', workflow)),
		dockerfileHash: dockerfile ? fileSha256(resolve(adapter.dir, dockerfile)) : null,
		sourceHashes,
		dependencyProofIds,
	};
	return {
		subject: subjectForPackage(adapter),
		driver,
		inputs: {
			...baseInputs,
			inputHash: computeProofInputHash({
				root,
				subject: subjectForPackage(adapter),
				driver,
				...baseInputs,
			}),
		},
	};
}

function selectAdapters(root: string, subject?: string | null) {
	const adapters = discoverTreeseedPackageAdapters(root);
	if (!subject) return adapters;
	const normalized = subject.replace(/^package:/u, '');
	return adapters.filter((adapter) => adapter.id === normalized || adapter.name === normalized || `package:${adapter.id}` === subject);
}

export function buildTreeseedProofPlan(input: {
	root: string;
	target?: TreeseedProofTarget;
	driver?: TreeseedProofDriver;
	subject?: string | null;
}): TreeseedProofPlan {
	const target = input.target ?? 'staging';
	const driver = input.driver ?? 'github-hosted';
	const subjects: TreeseedProofPlanSubject[] = [];
	const proofIds = new Map<string, string>();
	for (const adapter of selectAdapters(input.root, input.subject)) {
		const dependencyProofIds: string[] = [];
		const proofInput = proofInputForPackage(input.root, adapter, driver, dependencyProofIds);
		const reusableProof = findReusableProof(input.root, proofInput);
		if (reusableProof) proofIds.set(adapter.id, reusableProof.proofId);
		const workflow = driver === 'github-hosted' ? hostedWorkflowForPackage(adapter) : null;
		const command = driver === 'github-hosted' ? null : commandForPackage(adapter, driver);
		subjects.push({
			...proofInput,
			workflow,
			command,
			authority: driver === 'github-hosted' ? 'authoritative' : 'advisory',
			reusableProof,
			rerunReasons: reusableProof ? [] : ['No reusable passed proof record matches this subject, driver, and input hash.'],
		});
	}
	return {
		target,
		driver,
		subjects,
		summary: {
			subjects: subjects.length,
			reusable: subjects.filter((subject) => subject.reusableProof).length,
			pending: subjects.filter((subject) => !subject.reusableProof).length,
		},
	};
}

export function summarizeTreeseedProofLedger(root: string) {
	const records = readProofLedger(root);
	const failures = records.filter((record) => record.status === 'failed' || record.status === 'blocked');
	const latest = records[0] ?? null;
	const slowest = [...records]
		.filter((record) => typeof record.durationMs === 'number')
		.sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
		.slice(0, 10)
		.map((record) => ({
			subject: record.subject.id,
			driver: record.driver,
			durationMs: record.durationMs,
			status: record.status,
			reason: record.invalidationReasons[0] ?? (record.reusable ? 'Proof record is reusable.' : 'Proof record is not reusable.'),
		}));
	return {
		records,
		latest,
		failures,
		slowest,
		summary: {
			records: records.length,
			passed: records.filter((record) => record.status === 'passed').length,
			failed: failures.length,
			pending: records.filter((record) => record.status === 'pending').length,
			reusable: records.filter((record) => record.reusable).length,
		},
	};
}
