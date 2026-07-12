import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { findTreeseedPackageAdapter } from '../../operations/services/package-adapters.ts';
import { checkedOutTemplateRepositories } from '../../operations/services/managed-repositories.ts';
import { runTreeseedGitText } from '../../operations/services/git-runner.ts';
import type { TreeseedReconcileRunContext, TreeseedReconcileSelector, TreeseedReconcileTarget } from '../contracts.ts';

function requireMatchingStageCandidate(tenantRoot: string, packageId: string, packageDir: string) {
	const candidatePath = resolve(tenantRoot, '.treeseed/workflow/stage-candidates/latest.json');
	if (!existsSync(candidatePath)) {
		throw new Error(`Release verification requires a successful staged candidate; ${candidatePath} is missing.`);
	}
	const candidate = JSON.parse(readFileSync(candidatePath, 'utf8')) as {
		targetBranch?: string;
		root?: { commit?: string; verified?: boolean };
		packages?: Array<{ name?: string; commit?: string; verified?: boolean }>;
	};
	const packageProof = candidate.packages?.find((entry) => entry.name === packageId);
	const packageHead = runTreeseedGitText(['rev-parse', 'HEAD'], { cwd: packageDir, mode: 'read' }).trim();
	const rootHead = runTreeseedGitText(['rev-parse', 'HEAD'], { cwd: tenantRoot, mode: 'read' }).trim();
	if (candidate.targetBranch !== 'staging'
		|| candidate.root?.verified !== true
		|| candidate.root.commit !== rootHead
		|| packageProof?.verified !== true
		|| packageProof.commit !== packageHead) {
		throw new Error(`Release verification requires ${packageId} and the Market root to match the latest verified staging candidate.`);
	}
	return {
		status: 'staging-proof-reused' as const,
		candidatePath,
		packageCommit: packageHead,
		rootCommit: rootHead,
	};
}

export async function runReleaseVerifyCommand(input: {
	tenantRoot: string;
	packageId: string;
	env?: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}) {
	const adapter = findTreeseedPackageAdapter(input.tenantRoot, input.packageId);
	if (!adapter) {
		throw new Error(`Package ${input.packageId} was not discovered.`);
	}
	const command = adapter.verifyCommands.release ?? adapter.verifyCommands.local;
	if (!command) {
		return {
			ok: true,
			skipped: true,
			reason: `${input.packageId} has no release verify command.`,
		};
	}
	const stagingProof = requireMatchingStageCandidate(input.tenantRoot, input.packageId, adapter.dir);
	input.onProgress?.(`Reusing exact-SHA staging verification for ${input.packageId} at ${stagingProof.packageCommit.slice(0, 12)}.`);
	return {
		ok: true,
		skipped: true,
		reason: `${input.packageId} matches the latest verified staging candidate; tag workflows perform independent release verification before publication or deployment.`,
		dependencies: stagingProof,
	};
}

function runTemplateCommand(command: string, cwd: string, env?: NodeJS.ProcessEnv) {
	const result = spawnSync('bash', ['-lc', command], {
		cwd,
		env: { ...process.env, ...(env ?? {}) },
		encoding: 'utf8',
	});
	return {
		ok: (result.status ?? 1) === 0,
		status: result.status,
		command,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}

export function runTemplateReleaseVerifyCommand(input: {
	tenantRoot: string;
	templateId: string;
	env?: NodeJS.ProcessEnv;
}) {
	const repo = checkedOutTemplateRepositories(input.tenantRoot)
		.find((candidate) => candidate.templateManifest?.id === input.templateId);
	if (!repo?.templateManifest) {
		throw new Error(`Template ${input.templateId} was not discovered.`);
	}
	const command = repo.templateManifest.verify.release ?? repo.templateManifest.verify.local;
	if (!command) {
		return {
			ok: true,
			skipped: true,
			reason: `${input.templateId} has no release verify command.`,
		};
	}
	return runTemplateCommand(command, repo.dir, input.env);
}

function gitText(repoDir: string, args: string[]) {
	return runTreeseedGitText(args, { cwd: repoDir, mode: 'mutate' }).trim();
}

function gitTextAllowFailure(repoDir: string, args: string[]) {
	try {
		return gitText(repoDir, args);
	} catch {
		return null;
	}
}

export function ensureTemplateReleaseTag(input: {
	tenantRoot: string;
	templateId: string;
	tagName: string;
}) {
	const repo = checkedOutTemplateRepositories(input.tenantRoot)
		.find((candidate) => candidate.templateManifest?.id === input.templateId);
	if (!repo?.templateManifest) {
		throw new Error(`Template ${input.templateId} was not discovered.`);
	}
	const head = gitText(repo.dir, ['rev-parse', 'HEAD']);
	const local = gitTextAllowFailure(repo.dir, ['rev-list', '-n', '1', input.tagName]);
	if (local && local !== head) {
		throw new Error(`Template tag ${input.tagName} already exists at ${local}, expected ${head}.`);
	}
	if (!local) {
		gitText(repo.dir, ['tag', '-a', input.tagName, head, '-m', `release: ${input.tagName}`]);
	}
	const remote = gitTextAllowFailure(repo.dir, ['ls-remote', 'origin', `refs/tags/${input.tagName}`])
		?.split(/\s+/u)[0] ?? null;
	if (remote && remote !== head) {
		throw new Error(`Remote template tag ${input.tagName} already exists at ${remote}, expected ${head}.`);
	}
	if (!remote && repo.hasOriginRemote) {
		gitText(repo.dir, ['push', 'origin', input.tagName]);
	}
	return {
		templateId: input.templateId,
		tagName: input.tagName,
		head,
		local: local ? 'existing' : 'created',
		remote: remote ? 'existing' : repo.hasOriginRemote ? 'pushed' : 'skipped-no-origin',
	};
}

export function writeReleaseRecord(input: {
	tenantRoot: string;
	recordPath: string;
	record: Record<string, unknown>;
}) {
	const absolutePath = resolve(input.tenantRoot, input.recordPath);
	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, `${JSON.stringify(input.record, null, 2)}\n`, 'utf8');
	return {
		path: absolutePath,
		record: input.record,
	};
}

export async function runHostedReconcileGate(input: {
	parentContext: TreeseedReconcileRunContext;
	selector: TreeseedReconcileSelector;
	target: TreeseedReconcileTarget;
	planOnly: boolean;
}) {
	const { reconcileTreeseedNestedTarget } = await import('../engine.ts');
	return reconcileTreeseedNestedTarget(input);
}

export async function runHostedVerifyGate(input: {
	parentContext: TreeseedReconcileRunContext;
	selector: TreeseedReconcileSelector;
	target: TreeseedReconcileTarget;
}) {
	const { verifyTreeseedNestedTarget } = await import('../engine.ts');
	return verifyTreeseedNestedTarget(input);
}
