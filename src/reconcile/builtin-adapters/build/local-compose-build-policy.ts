import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ObservedUnitState, ReconcileAdapterInput } from '../../support/contracts/contracts.ts';
import { resolveGitHubCredentialForRepository } from '../../../operations/services/configuration/github-credentials.ts';
import { checkHttpHealth } from '../../providers/local-private.ts';
import { runRepositoryGit } from '../../../operations/services/operations/git-runner.ts';
import { genericObservedState } from '../hosting/to-deploy-target.ts';

export function localComposeBuildPolicy(input: ReconcileAdapterInput): 'never' | 'missing' | 'always' {
	return input.unit.spec.buildPolicy === 'never' || input.unit.spec.buildPolicy === 'always'
		? input.unit.spec.buildPolicy
		: 'missing';
}

export function runLocalComposePrepareCommand(input: ReconcileAdapterInput) {
	const prepareCommand = input.unit.spec.prepareCommand;
	if (!prepareCommand || typeof prepareCommand !== 'object') return;
	const command = typeof (prepareCommand as Record<string, unknown>).command === 'string'
		? String((prepareCommand as Record<string, unknown>).command)
		: null;
	const rawArgs = (prepareCommand as Record<string, unknown>).args;
	const args = Array.isArray(rawArgs)
		? rawArgs.filter((entry): entry is string => typeof entry === 'string')
		: [];
	if (!command) return;
	const result = spawnSync(command, args, {
		cwd: input.context.tenantRoot,
		env: buildLocalComposeLaunchEnv(input),
		encoding: 'utf8',
		stdio: 'pipe',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} ${args.join(' ')} failed`);
	}
}

export async function checkHttpHealthWithRetry(url: string, attempts = 90, intervalMs = 2_000) {
	let last = await checkHttpHealth(url);
	for (let attempt = 1; attempt < attempts && !last.ok; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
		last = await checkHttpHealth(url);
	}
	return last;
}

export function buildLocalComposeLaunchEnv(input: ReconcileAdapterInput) {
	return {
		...input.context.launchEnv,
		TREESEED_PROVIDER_HOST_DATA_DIR: '.treeseed/local-capacity-provider/data',
		TREESEED_PROVIDER_ENVIRONMENT: 'local',
		TREESEED_AGENT_IMAGE_TAG: 'latest',
		...(typeof input.unit.spec.env === 'object' && input.unit.spec.env ? input.unit.spec.env as Record<string, string> : {}),
	};
}

export function localContentSpecString(input: ReconcileAdapterInput, key: string) {
	const value = input.unit.spec[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function localContentSpecRecord(input: ReconcileAdapterInput, key: string) {
	const value = input.unit.spec[key];
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function localContentGitEnvironment(input: ReconcileAdapterInput) {
	const repo = localContentSpecRecord(input, 'contentRepository');
	const owner = typeof repo.owner === 'string' ? repo.owner : '';
	const name = typeof repo.name === 'string' ? repo.name : '';
	if (!owner || !name) return { env: input.context.launchEnv, credential: null as ReturnType<typeof resolveGitHubCredentialForRepository> | null };
	const credential = resolveGitHubCredentialForRepository(`${owner}/${name}`, { env: input.context.launchEnv });
	const env = credential.token
		? {
				...input.context.launchEnv,
				TREESEED_GITHUB_TOKEN: credential.token,
				GH_TOKEN: credential.token,
				GITHUB_TOKEN: credential.token,
			}
		: input.context.launchEnv;
	return { env, credential };
}

export function localContentPathInsideTenant(input: ReconcileAdapterInput, targetPath: string | null) {
	if (!targetPath) return true;
	const resolvedTarget = resolve(targetPath);
	const resolvedTenant = resolve(input.context.tenantRoot);
	return resolvedTarget === resolvedTenant || resolvedTarget.startsWith(`${resolvedTenant}/`);
}

export function inspectLocalContentGit(targetPath: string) {
	const origin = runRepositoryGit(['remote', 'get-url', 'origin'], { cwd: targetPath, mode: 'read', allowFailure: true }).stdout.trim();
	const branch = runRepositoryGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: targetPath, mode: 'read', allowFailure: true }).stdout.trim();
	const status = runRepositoryGit(['status', '--porcelain'], { cwd: targetPath, mode: 'read', allowFailure: true }).stdout.trim();
	return {
		isGit: Boolean(runRepositoryGit(['rev-parse', '--is-inside-work-tree'], { cwd: targetPath, mode: 'read', allowFailure: true }).stdout.trim()),
		origin: origin || null,
		branch: branch || null,
		dirty: status.length > 0,
	};
}

export function localContentObservedState(input: ReconcileAdapterInput): ObservedUnitState {
	const targetPath = localContentSpecString(input, 'effectiveLocalPath');
	const materialization = localContentSpecString(input, 'localContentMaterialization') ?? 'none';
	const executeRequested = input.unit.spec.executeRequested === true;
	const warnings: string[] = [];
	if (!localContentPathInsideTenant(input, targetPath)) {
		warnings.push('local content target path is outside the Treeseed workspace');
		return {
			...genericObservedState(input, false, warnings),
			status: 'error',
			live: {
				...input.unit.spec,
				targetPath,
				materializationStatus: 'blocked',
			},
		};
	}
	if (materialization === 'none' || !targetPath) {
		return {
			...genericObservedState(input, true, warnings),
			live: {
				...input.unit.spec,
				materializationStatus: 'not_requested',
			},
		};
	}
	const exists = existsSync(targetPath);
	const stat = exists ? statSync(targetPath) : null;
	if (exists && !stat?.isDirectory()) {
		warnings.push('local content target path exists but is not a directory');
		return {
			...genericObservedState(input, false, warnings),
			status: 'error',
			live: {
				...input.unit.spec,
				targetPath,
				materializationStatus: 'blocked',
			},
		};
	}
	const git = exists ? inspectLocalContentGit(targetPath) : null;
	if (exists && materialization === 'managed_clone' && !git?.isGit) {
		warnings.push('managed local content target exists but is not a Git worktree');
		return {
			...genericObservedState(input, false, warnings),
			status: 'error',
			live: {
				...input.unit.spec,
				targetPath,
				materializationStatus: 'blocked',
				git,
			},
		};
	}
	const status = exists
		? materialization === 'managed_clone'
			? 'managed_clone_ready'
			: materialization === 'submodule'
				? 'submodule_ready'
				: 'existing_path_ready'
		: materialization === 'managed_clone'
			? 'managed_clone_missing'
			: materialization === 'submodule'
				? 'submodule_missing'
				: 'existing_path_missing';
	if (git?.dirty) {
		warnings.push('local content Git worktree has uncommitted changes; Treeseed will not reset or overwrite it');
	}
	return {
		...genericObservedState(input, exists || !executeRequested, warnings),
		status: exists || !executeRequested ? 'ready' : 'pending',
		live: {
			...input.unit.spec,
			targetPath,
			materializationStatus: status,
			git,
		},
		locators: {
			unitId: input.unit.unitId,
			targetPath,
			origin: git?.origin ?? null,
		},
	};
}

export function expectedLocalContentOrigin(input: ReconcileAdapterInput) {
	const repo = localContentSpecRecord(input, 'contentRepository');
	return typeof repo.gitUrl === 'string' ? repo.gitUrl : null;
}

export function originMatches(observed: ObservedUnitState, expected: string | null) {
	const liveGit = observed.live.git && typeof observed.live.git === 'object' ? observed.live.git as Record<string, unknown> : null;
	const origin = typeof liveGit?.origin === 'string' ? liveGit.origin : null;
	return !origin || !expected || origin === expected || origin.replace(/\.git$/u, '') === expected.replace(/\.git$/u, '');
}

export function githubRepoSlugFromUrl(url: string | null) {
	if (!url) return null;
	if (!/^(https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/iu.test(url)) return null;
	const raw = url
		.replace(/^https?:\/\/github\.com\//iu, '')
		.replace(/^git@github\.com:/iu, '')
		.replace(/^ssh:\/\/git@github\.com\//iu, '')
		.replace(/\.git$/iu, '')
		.replace(/^\/+|\/+$/gu, '');
	const [owner, name, ...extra] = raw.split('/').filter(Boolean);
	return owner && name && extra.length === 0 ? `${owner}/${name}` : null;
}

export function runLocalContentClone(input: ReconcileAdapterInput, targetPath: string, gitUrl: string, branch: string | null) {
	mkdirSync(dirname(targetPath), { recursive: true });
	const { env, credential } = localContentGitEnvironment(input);
	const repoSlug = githubRepoSlugFromUrl(gitUrl);
	if (repoSlug && credential?.configured) {
		const args = ['repo', 'clone', repoSlug, targetPath, '--'];
		if (branch) args.push('--branch', branch);
		const result = spawnSync('gh', args, {
			cwd: input.context.tenantRoot,
			env: env as NodeJS.ProcessEnv,
			encoding: 'utf8',
			stdio: 'pipe',
			timeout: 120_000,
			maxBuffer: 1024 * 1024 * 16,
		});
		if (result.status !== 0) {
			throw new Error((result.stderr || result.stdout || 'GitHub CLI clone failed. Run `npx trsd install --json` and configure TREESEED_GITHUB_TOKEN if this repository is private.').trim());
		}
		return {
			status: result.status,
			stdout: result.stdout ?? '',
			stderr: result.stderr ?? '',
			tool: 'gh',
			credentialEnvName: credential.envName,
			fallbackUsed: credential.fallbackUsed,
		};
	}
	const args = ['clone'];
	if (branch) args.push('--branch', branch);
	args.push(gitUrl, targetPath);
	const result = runRepositoryGit(args, {
		cwd: input.context.tenantRoot,
		mode: 'mutate',
		env,
		timeoutMs: 120_000,
		maxBuffer: 1024 * 1024 * 16,
	});
	return {
		...result,
		tool: 'git',
		credentialEnvName: credential?.envName ?? null,
		fallbackUsed: credential?.fallbackUsed ?? false,
	};
}
