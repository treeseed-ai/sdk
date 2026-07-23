#!/usr/bin/env node

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import yaml from 'yaml';
import { packageScriptPath } from '../src/operations/services/runtime-tools.ts';
import { collectCliPreflight, createWranglerCommandEnv, formatCliPreflightReport, writeJsonArtifact } from '../src/operations/services/workspace-preflight.ts';
import { ensureDeployWorkflow, parseGitHubRepositoryFromRemote } from '../src/operations/services/github-automation.ts';
import { MERGE_CONFLICT_EXIT_CODE } from '../src/operations/services/workspace-save.ts';
import { createTempDir, run, workspacePackages, workspaceRoot } from '../src/operations/services/workspace-tools.ts';
import { artifactsRoot, cacheEnv, createManualPackageTarball, log, randomPort, root, runCommand, withStep } from './root.ts';
import { appendSaveMarker, cloneLocalWorkspace, cloneLocalWorkspaceWithBareOrigin, cloneStagingRepository, isProductionLikeTarget, readTenantConfig, resolveRepositorySlug, runDevSession, scaffoldTenant, waitForGitHubWorkflow, waitForUrl, writeWorkspaceStub } from './run-dev-session.ts';

async function runLocalSuite() {
	const preflight = collectCliPreflight({ cwd: root, requireAuth: false });
	writeJsonArtifact(resolve(artifactsRoot, 'preflight.local.json'), preflight);
	log(formatCliPreflightReport(preflight));

	await withStep('workspace dev smoke', async () => {
		return await runDevSession('workspace-dev-smoke', root, {
			args: ['--port', String(randomPort(8800))],
		});
	});

	const dependencies = new Map();
	const manualTarballs = [];
	await withStep('local package tarball preparation', async () => {
		for (const packageName of ['@treeseed/sdk', '@treeseed/core']) {
			const pkg = workspacePackages(root).find((entry) => entry.name === packageName);
			if (!pkg) {
				throw new Error(`Unable to find workspace package ${packageName}.`);
			}
			run('npm', ['run', 'build:dist'], { cwd: pkg.dir });
			const packaged = createManualPackageTarball(pkg);
			manualTarballs.push(packaged);
			dependencies.set(packageName, packaged.tarballPath);
		}
		return Object.fromEntries(dependencies);
	});

	const siteRoot = mkdtempSync(join(tmpdir(), 'treeseed-command-e2e-site-'));
	try {
		await withStep('scaffold tenant init', async () => {
			scaffoldTenant(siteRoot, dependencies, manualTarballs);
			return { siteRoot };
		});

		await withStep('scaffold tenant dev watch smoke', async () => {
			const notePath = resolve(siteRoot, 'src', 'content', 'notes', 'first-note.mdx');
			return await runDevSession('scaffold-dev-watch', siteRoot, {
				args: ['--watch', '--port', String(randomPort(9300))],
				mutate: async () => {
					appendSaveMarker(notePath, 'treeseed-e2e-local-watch');
				},
			});
		});

		await withStep('scaffold tenant build', async () => {
			return runCommand('scaffold-build', process.execPath, [packageScriptPath('treeseed'), 'build'], {
				cwd: siteRoot,
				env: cacheEnv(),
			});
		});

		await withStep('scaffold tenant deploy plan', async () => {
			return runCommand('scaffold-deploy-plan', process.execPath, [packageScriptPath('treeseed'), 'deploy', '--plan'], {
				cwd: siteRoot,
				env: cacheEnv(),
			});
		});

		await withStep('scaffold tenant destroy plan', async () => {
			const deployConfig = readTenantConfig(siteRoot);
			return runCommand('scaffold-destroy-plan', process.execPath, [packageScriptPath('treeseed'), 'destroy', '--plan', '--skip-confirmation', '--confirm', String(deployConfig.slug)], {
				cwd: siteRoot,
				env: cacheEnv(),
			});
		});
	} finally {
		rmSync(siteRoot, { recursive: true, force: true });
		for (const packaged of manualTarballs) {
			rmSync(packaged.tarballPath, { force: true });
			rmSync(packaged.stageRoot, { recursive: true, force: true });
		}
	}

	await withStep('save guard: missing message', async () => {
		return runCommand('save-missing-message', process.execPath, [packageScriptPath('treeseed'), 'save'], {
			cwd: root,
			allowedExitCodes: [1],
		});
	});

	await withStep('save guard: wrong branch', async () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'treeseed-save-branch-'));
		try {
			run('git', ['init', '--initial-branch=feature/e2e'], { cwd: repoDir });
			writeWorkspaceStub(repoDir);
			return runCommand('save-wrong-branch', process.execPath, [packageScriptPath('treeseed'), 'save', 'test: wrong branch'], {
				cwd: repoDir,
				allowedExitCodes: [1],
			});
		} finally {
			rmSync(repoDir, { recursive: true, force: true });
		}
	});

	await withStep('save guard: missing origin', async () => {
		const repoDir = mkdtempSync(join(tmpdir(), 'treeseed-save-origin-'));
		try {
			run('git', ['init', '--initial-branch=main'], { cwd: repoDir });
			writeWorkspaceStub(repoDir);
			return runCommand('save-missing-origin', process.execPath, [packageScriptPath('treeseed'), 'save', 'test: missing origin'], {
				cwd: repoDir,
				allowedExitCodes: [1],
			});
		} finally {
			rmSync(repoDir, { recursive: true, force: true });
		}
	});

	await withStep('save guard: no changes', async () => {
		const clonedWorkspace = cloneLocalWorkspace();
		try {
			return runCommand('save-no-changes', process.execPath, [packageScriptPath('treeseed'), 'save', 'test: no-op save'], {
				cwd: clonedWorkspace.workingRoot,
				env: cacheEnv(),
			});
		} finally {
			rmSync(clonedWorkspace.cloneRoot, { recursive: true, force: true });
		}
	});

	await withStep('save success: local bare origin with local-only install checks', async () => {
		const clonedWorkspace = cloneLocalWorkspaceWithBareOrigin();
		try {
			const notePath = resolve(clonedWorkspace.workingRoot, 'src/content/notes/first-note.mdx');
			appendSaveMarker(notePath, 'treeseed-e2e-local-save-success');
			const saveReportPath = resolve(artifactsRoot, 'save-local-success.json');
			const result = runCommand('save-local-success', process.execPath, [packageScriptPath('treeseed'), 'save', 'test: local save success'], {
				cwd: clonedWorkspace.workingRoot,
				env: {
					...cacheEnv(),
					TREESEED_SAVE_NPM_INSTALL_MODE: 'skip',
					TREESEED_SAVE_REPORT_PATH: saveReportPath,
				},
				timeoutMs: 1800000,
			});
			const localHead = run('git', ['rev-parse', 'HEAD'], { cwd: clonedWorkspace.cloneRoot, capture: true }).trim();
			const remoteHead = run('git', ['--git-dir', clonedWorkspace.bareRoot, 'rev-parse', 'refs/heads/main'], { cwd: root, capture: true }).trim();
			if (localHead !== remoteHead) {
				throw new Error(`Expected pushed head ${remoteHead} to match local head ${localHead}.`);
			}
			return {
				...result,
				saveReportPath,
				localHead,
				remoteHead,
			};
		} finally {
			rmSync(clonedWorkspace.cloneRoot, { recursive: true, force: true });
			rmSync(clonedWorkspace.bareRoot, { recursive: true, force: true });
		}
	});
}

async function runStagingSuite() {
	const preflight = collectCliPreflight({ cwd: root, requireAuth: true });
	writeJsonArtifact(resolve(artifactsRoot, 'preflight.staging.json'), preflight);
	log(formatCliPreflightReport(preflight));
	if (!preflight.ok) {
		throw new Error('Staging preflight failed.');
	}

	const staging = cloneStagingRepository();
	try {
		const repository = resolveRepositorySlug(staging.cloneRoot);
		const deployConfig = readTenantConfig(staging.workingRoot);
		if (!process.env.TREESEED_E2E_ALLOW_PRODUCTION && isProductionLikeTarget(repository, deployConfig.siteUrl)) {
			throw new Error(`Refusing to run staging E2E against production-like target ${repository} / ${deployConfig.siteUrl}.`);
		}

		await withStep('staging deploy', async () => {
			return runCommand('staging-deploy', 'npm', ['run', 'deploy', '--', '--name', 'treeseed-e2e-staging'], {
				cwd: staging.workingRoot,
				env: cacheEnv(createWranglerCommandEnv()),
				timeoutMs: 900000,
			});
		});

		await withStep('staging site reachability', async () => {
			return await waitForUrl(deployConfig.siteUrl);
		});

		const notePath = resolve(staging.workingRoot, process.env.TREESEED_E2E_SAVE_FILE ?? 'src/content/notes/first-note.mdx');
		for (const iteration of [1, 2]) {
			await withStep(`staging save iteration ${iteration}`, async () => {
				const marker = `treeseed-e2e-save-${iteration}`;
				appendSaveMarker(notePath, marker);
				const saveReportPath = resolve(artifactsRoot, `save-iteration-${iteration}.json`);
				runCommand(`staging-save-${iteration}`, 'npm', ['run', 'save', '--', `test: treeseed e2e save iteration ${iteration}`], {
					cwd: staging.workingRoot,
					env: {
						...cacheEnv(createWranglerCommandEnv()),
						TREESEED_SAVE_REPORT_PATH: saveReportPath,
					},
					timeoutMs: 1800000,
				});
				const headSha = run('git', ['rev-parse', 'HEAD'], { cwd: staging.cloneRoot, capture: true }).trim();
				const workflow = await waitForGitHubWorkflow(repository, headSha);
				const siteCheck = await waitForUrl(deployConfig.siteUrl, { contains: marker, timeoutMs: 600000 });
				return {
					headSha,
					workflow,
					siteCheck,
					saveReportPath,
				};
			});
		}

		await withStep('staging save no-op guard', async () => {
			return runCommand('staging-save-no-op', 'npm', ['run', 'save', '--', 'test: staging no-op save'], {
				cwd: staging.workingRoot,
				env: cacheEnv(createWranglerCommandEnv()),
				timeoutMs: 180000,
			});
		});

		await withStep('staging merge-conflict reporting', async () => {
			const local = cloneStagingRepository();
			const remote = cloneStagingRepository();
			const relativeSaveFile = process.env.TREESEED_E2E_SAVE_FILE ?? 'src/content/notes/first-note.mdx';
			try {
				appendSaveMarker(resolve(remote.workingRoot, relativeSaveFile), 'treeseed-e2e-remote-conflict');
				run('git', ['add', '.'], { cwd: remote.cloneRoot });
				run('git', ['commit', '-m', 'test: remote conflict seed'], { cwd: remote.cloneRoot });
				run('git', ['push', 'origin', 'main'], { cwd: remote.cloneRoot });

				appendSaveMarker(resolve(local.workingRoot, relativeSaveFile), 'treeseed-e2e-local-conflict');
				const saveReportPath = resolve(artifactsRoot, 'save-conflict.json');
				const result = runCommand('staging-save-conflict', 'npm', ['run', 'save', '--', 'test: staging merge conflict'], {
					cwd: local.workingRoot,
					env: {
						...cacheEnv(createWranglerCommandEnv()),
						TREESEED_SAVE_REPORT_PATH: saveReportPath,
					},
					allowedExitCodes: [MERGE_CONFLICT_EXIT_CODE],
					timeoutMs: 1800000,
				});
				return {
					exitCode: result.status,
					saveReportPath,
				};
			} finally {
				try {
					run('git', ['rebase', '--abort'], { cwd: local.cloneRoot, capture: true });
				} catch {
					// Best effort cleanup for the temporary clone.
				}
				rmSync(local.cloneRoot, { recursive: true, force: true });
				rmSync(remote.cloneRoot, { recursive: true, force: true });
			}
		});

		await withStep('staging destroy', async () => {
			return runCommand('staging-destroy', 'npm', ['run', 'destroy', '--', '--force', '--skip-confirmation', '--confirm', String(deployConfig.slug), '--remove-build-artifacts'], {
				cwd: staging.workingRoot,
				env: cacheEnv(createWranglerCommandEnv()),
				timeoutMs: 900000,
			});
		});
	} finally {
		rmSync(staging.cloneRoot, { recursive: true, force: true });
	}
}
