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
import { artifactsRoot, cacheEnv, isBindFailureOutput, portFromArgs, root, runBuildSmoke, runCommand, sanitizeFileName, shellEscape, waitForLocalDevReady, waitForRegexOutput } from './root.ts';

async function runDevSession(label, cwd, {
	args: devArgs = [],
	env = {},
	readyPattern = /ready on|http:\/\/127\.0\.0\.1|http:\/\/localhost|starting unified wrangler watch mode/i,
	rebuildPattern = /rebuild complete|detected \d+ change/i,
	mutate = null,
	timeoutMs = 180000,
} = {}) {
	const port = portFromArgs(devArgs);
	const commandLine = [process.execPath, packageScriptPath('treeseed'), 'dev', ...devArgs].map(shellEscape).join(' ');
	const child = spawn('script', ['-qefc', commandLine, '/dev/null'], {
		cwd,
		env: {
			...process.env,
			...cacheEnv(createWranglerCommandEnv(env)),
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const output = { text: '' };
	const childState = { exited: false, code: null, signal: null };
	child.stdout.on('data', (chunk) => {
		output.text += String(chunk);
	});
	child.stderr.on('data', (chunk) => {
		output.text += String(chunk);
	});
	child.on('exit', (code, signal) => {
		childState.exited = true;
		childState.code = code;
		childState.signal = signal;
	});

	const logPath = resolve(artifactsRoot, 'commands', `${sanitizeFileName(label)}.log`);
	mkdirSync(dirname(logPath), { recursive: true });
	let pendingError = null;

	try {
		await waitForLocalDevReady(output, port, timeoutMs, `${label} readiness`, readyPattern, childState);
		if (mutate) {
			await mutate();
			await waitForRegexOutput(output, rebuildPattern, timeoutMs, `${label} rebuild`);
		}
	} catch (error) {
		pendingError = error;
	} finally {
		if (!childState.exited) {
			child.kill('SIGTERM');
			await new Promise((resolvePromise) => child.once('exit', () => resolvePromise()));
		}
		writeFileSync(logPath, output.text, 'utf8');
	}

	if (pendingError && childState.code && isBindFailureOutput(output.text)) {
		if (mutate) {
			await mutate();
			runBuildSmoke(`${label}-fallback-build`, cwd);
		}
		return {
			logPath,
			outputPreview: output.text.slice(-4000),
			degraded: 'bind_failure_fallback',
		};
	}

	if (pendingError) {
		throw pendingError;
	}

	return {
		logPath,
		outputPreview: output.text.slice(-4000),
	};
}

function rewriteScaffoldDependencies(siteRoot, dependencies) {
	const packageJsonPath = resolve(siteRoot, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	packageJson.dependencies = packageJson.dependencies ?? {};
	for (const [name, specifier] of dependencies.entries()) {
		packageJson.dependencies[name] = specifier;
	}
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}

function installManualPackageTarball(siteRoot, packaged) {
	const extractRoot = mkdtempSync(join(tmpdir(), 'treeseed-package-extract-'));
	run('tar', ['-xzf', packaged.tarballPath, '-C', extractRoot], { cwd: root });
	const scopeRoot = resolve(siteRoot, 'node_modules', '@treeseed');
	mkdirSync(scopeRoot, { recursive: true });
	const targetPath = resolve(scopeRoot, packaged.packageName.split('/')[1]);
	cpSync(resolve(extractRoot, 'package'), targetPath, { recursive: true });
	rmSync(extractRoot, { recursive: true, force: true });
}

function scaffoldTenant(siteRoot, dependencies, packagedTarballs) {
	run(process.execPath, [
		packageScriptPath('scaffold-site'),
		siteRoot,
		'--name',
		'Treeseed E2E Site',
		'--site-url',
		'https://staging.treeseed-e2e.example.com',
		'--contact-email',
		'e2e@example.com',
	], { cwd: root });
	rewriteScaffoldDependencies(siteRoot, dependencies);
	for (const packaged of packagedTarballs) {
		installManualPackageTarball(siteRoot, packaged);
	}

	const sharedNodeModules = resolve(root, 'node_modules');
	const sharedLinks = readdirSync(sharedNodeModules, { withFileTypes: true })
		.filter((entry) => entry.name !== '.bin' && entry.name !== '@treeseed')
		.map((entry) => [entry.name, resolve(sharedNodeModules, entry.name)]);
	const copiedSharedPackages = new Set(['astro', '@astrojs']);
	for (const [name, target] of sharedLinks) {
		const targetPath = resolve(siteRoot, 'node_modules', name);
		mkdirSync(dirname(targetPath), { recursive: true });
		if (copiedSharedPackages.has(name)) {
			cpSync(target, targetPath, { recursive: true });
			continue;
		}
		try {
			symlinkSync(target, targetPath, 'dir');
		} catch (error) {
			if (!(error instanceof Error) || !String(error.message).includes('EEXIST')) {
				throw error;
			}
		}
	}
}

function readTenantConfig(tenantRoot) {
	return yaml.parse(readFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), 'utf8'));
}

function appendSaveMarker(filePath, marker) {
	const source = readFileSync(filePath, 'utf8');
	writeFileSync(filePath, `${source.trimEnd()}\n\nTreeseed E2E marker: ${marker}\n`, 'utf8');
}

function writeWorkspaceStub(repoDir) {
	writeFileSync(
		resolve(repoDir, 'package.json'),
		`${JSON.stringify(
			{
				name: 'treeseed-save-local',
				private: true,
				workspaces: ['packages/*'],
			},
			null,
			2,
		)}\n`,
		'utf8',
	);
}

function cloneLocalWorkspace() {
	const cloneRoot = mkdtempSync(join(tmpdir(), 'treeseed-local-workspace-'));
	run('git', ['clone', '--depth', '1', resolve(root, '..'), cloneRoot], { cwd: root });
	const workingRoot = resolve(cloneRoot, 'docs');
	run('git', ['config', 'user.name', 'Treeseed E2E'], { cwd: cloneRoot });
	run('git', ['config', 'user.email', 'e2e@treeseed.dev'], { cwd: cloneRoot });
	const workflow = ensureDeployWorkflow(workingRoot);
	if (workflow.changed) {
		run('git', ['add', 'docs/.github/workflows/deploy-web.yml'], { cwd: cloneRoot });
		run('git', ['commit', '-m', 'test: sync deploy workflow for no-op save guard'], { cwd: cloneRoot });
	}
	return {
		cloneRoot,
		workingRoot,
	};
}

function cloneLocalWorkspaceWithBareOrigin() {
	const bareRoot = mkdtempSync(join(tmpdir(), 'treeseed-local-origin-'));
	const cloneRoot = mkdtempSync(join(tmpdir(), 'treeseed-local-workspace-'));
	run('git', ['clone', '--bare', resolve(root, '..'), bareRoot], { cwd: root });
	run('git', ['clone', bareRoot, cloneRoot], { cwd: root });
	const workingRoot = resolve(cloneRoot, 'docs');
	run('git', ['config', 'user.name', 'Treeseed E2E'], { cwd: cloneRoot });
	run('git', ['config', 'user.email', 'e2e@treeseed.dev'], { cwd: cloneRoot });
	return {
		bareRoot,
		cloneRoot,
		workingRoot,
	};
}

function resolveRepositorySlug(repoDir) {
	const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: repoDir, capture: true }).trim();
	return parseGitHubRepositoryFromRemote(remote);
}

function isProductionLikeTarget(repository, siteUrl) {
	const productionRepositories = new Set(['knowledge-coop/market', 'treeseed-ai/market']);
	const normalizedSiteUrl = String(siteUrl ?? '').replace(/\/+$/u, '').toLowerCase();
	return productionRepositories.has(repository) || ['https://treeseed.dev', 'https://www.treeseed.dev'].includes(normalizedSiteUrl);
}

async function waitForGitHubWorkflow(repository, headSha, { timeoutMs = 900000 } = {}) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const result = runCommand(
			`gh-run-list-${headSha.slice(0, 7)}`,
			'gh',
			['run', 'list', '--repo', repository, '--limit', '20', '--json', 'databaseId,headSha,status,conclusion,url,workflowName,event,displayTitle'],
			{ cwd: root },
		);
		const runs = JSON.parse(result.stdout || '[]');
		const match = runs.find((entry) => entry.headSha === headSha && /deploy/i.test(entry.workflowName ?? ''));
		if (match?.status === 'completed') {
			if (match.conclusion !== 'success') {
				throw new Error(`GitHub workflow ${match.workflowName} for ${headSha} concluded with ${match.conclusion}.`);
			}
			return match;
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 10000));
	}

	throw new Error(`Timed out waiting for GitHub deploy workflow for ${headSha}.`);
}

async function waitForUrl(url, { contains = null, timeoutMs = 300000 } = {}) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		try {
			const response = await fetch(url);
			const body = await response.text();
			if (response.ok && (!contains || body.includes(contains))) {
				return {
					status: response.status,
					bodyPreview: body.slice(0, 1000),
				};
			}
		} catch {
			// Keep polling until timeout.
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
	}

	throw new Error(`Timed out waiting for ${url}${contains ? ` to contain "${contains}"` : ''}.`);
}

function cloneStagingRepository() {
	const gitUrl = process.env.TREESEED_E2E_STAGING_GIT_URL;
	if (!gitUrl) {
		throw new Error('TREESEED_E2E_STAGING_GIT_URL is required for staging E2E runs.');
	}
	const cloneRoot = mkdtempSync(join(tmpdir(), 'treeseed-staging-clone-'));
	run('git', ['clone', '--depth', '1', gitUrl, cloneRoot], { cwd: root });
	const subdir = process.env.TREESEED_E2E_STAGING_WORKING_DIRECTORY?.trim() || 'docs';
	const workingRoot = resolve(cloneRoot, subdir);
	run('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund'], {
		cwd: workingRoot,
		env: cacheEnv(),
	});
	run('git', ['config', 'user.name', 'Treeseed E2E'], { cwd: cloneRoot });
	run('git', ['config', 'user.email', 'e2e@treeseed.dev'], { cwd: cloneRoot });
	return {
		cloneRoot,
		workingRoot,
	};
}
