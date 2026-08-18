#!/usr/bin/env node

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import yaml from 'yaml';
import { packageScriptPath } from '../../src/operations/services/agents/runtime-tools.ts';
import { collectCliPreflight, createWranglerCommandEnv, formatCliPreflightReport, writeJsonArtifact } from '../../src/operations/services/treedx/workspaces/workspace-preflight.ts';
import { ensureDeployWorkflow, parseGitHubRepositoryFromRemote } from '../../src/operations/services/repositories/github-automation.ts';
import { MERGE_CONFLICT_EXIT_CODE } from '../../src/operations/services/treedx/workspaces/workspace-save.ts';
import { createTempDir, run, workspacePackages, workspaceRoot } from '../../src/operations/services/treedx/workspaces/workspace-tools.ts';


const root = workspaceRoot();

const argv = new Set(process.argv.slice(2));

const mode =
	argv.has('--mode=staging') || argv.has('--staging')
		? 'staging'
		: argv.has('--mode=full') || argv.has('--full')
			? 'full'
			: 'local';

const runLocal = mode === 'local' || mode === 'full';

const runStaging = mode === 'staging' || mode === 'full';

const npmCacheRoot = resolve(
	process.env.TREESEED_RELEASE_NPM_CACHE_DIR
		?? resolve(tmpdir(), 'treeseed-npm-cache'),
);

const artifactsRoot = process.env.TREESEED_E2E_ARTIFACTS_DIR
	? resolve(process.env.TREESEED_E2E_ARTIFACTS_DIR)
	: createTempDir('treeseed-command-e2e-');

mkdirSync(artifactsRoot, { recursive: true });

const report = {
	mode,
	startedAt: new Date().toISOString(),
	artifactsRoot,
	steps: [],
	summary: {
		ok: true,
	},
};

function log(message) {
	console.log(`[treeseed:e2e ${new Date().toISOString()}] ${message}`);
}

function sanitizeFileName(value) {
	return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function shellEscape(value) {
	return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function cacheEnv(extraEnv = {}) {
	return {
		npm_config_cache: npmCacheRoot,
		NPM_CONFIG_CACHE: npmCacheRoot,
		npm_config_prefer_offline: 'true',
		npm_config_audit: 'false',
		npm_config_fund: 'false',
		...extraEnv,
	};
}

function writeCommandArtifact(label, payload) {
	writeJsonArtifact(resolve(artifactsRoot, 'commands', `${sanitizeFileName(label)}.json`), payload);
}

function recordStep(name, data) {
	report.steps.push({
		name,
		...data,
	});
}

async function withStep(name, action) {
	const startedAt = Date.now();
	log(`${name} started`);
	try {
		const result = await action();
		recordStep(name, {
			status: 'completed',
			durationMs: Date.now() - startedAt,
			result,
		});
		log(`${name} completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
		return result;
	} catch (error) {
		report.summary.ok = false;
		recordStep(name, {
			status: 'failed',
			durationMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
		});
		log(`${name} failed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
		throw error;
	}
}

function writeReport() {
	report.finishedAt = new Date().toISOString();
	writeJsonArtifact(resolve(artifactsRoot, 'report.json'), report);
}

function runCommand(label, command, commandArgs, options = {}) {
	const startedAt = Date.now();
	const result = spawnSync(command, commandArgs, {
		cwd: options.cwd ?? root,
		env: { ...process.env, ...(options.env ?? {}) },
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: options.timeoutMs,
	});
	const entry = {
		label,
		command,
		args: commandArgs,
		cwd: options.cwd ?? root,
		status: result.status ?? 1,
		signal: result.signal ?? null,
		durationMs: Date.now() - startedAt,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
	writeCommandArtifact(label, entry);
	const allowedExitCodes = new Set(options.allowedExitCodes ?? [0]);
	if (!allowedExitCodes.has(entry.status)) {
		throw new Error(
			[
				`${label} failed with exit ${entry.status}.`,
				entry.stdout.trim(),
				entry.stderr.trim(),
			].filter(Boolean).join('\n'),
		);
	}
	return entry;
}

function randomPort(base) {
	return base + Math.floor(Math.random() * 500);
}

function waitForRegexOutput(bufferRef, regex, timeoutMs, label) {
	return new Promise((resolvePromise, reject) => {
		const startedAt = Date.now();
		const interval = setInterval(() => {
			if (regex.test(bufferRef.text)) {
				clearInterval(interval);
				resolvePromise({
					durationMs: Date.now() - startedAt,
				});
				return;
			}
			if (Date.now() - startedAt >= timeoutMs) {
				clearInterval(interval);
				reject(new Error(`${label} timed out waiting for ${regex}.`));
			}
		}, 250);
	});
}

function isBindFailureOutput(source) {
	return /listen EPERM|Address already in use|failed: ::bind\(|EADDRINUSE/i.test(source);
}

function portFromArgs(args) {
	const portFlagIndex = args.findIndex((value) => value === '--port');
	if (portFlagIndex >= 0) {
		const candidate = Number(args[portFlagIndex + 1]);
		return Number.isFinite(candidate) ? candidate : null;
	}
	return null;
}

async function waitForLocalDevReady(bufferRef, port, timeoutMs, label, readyPattern, childState) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (readyPattern.test(bufferRef.text)) {
			return;
		}
		if (childState.exited) {
			throw new Error(
				`${label} exited before reaching readiness (exit=${childState.code ?? 'unknown'} signal=${childState.signal ?? 'none'}).\n${bufferRef.text.trim()}`,
			);
		}
		if (port) {
			try {
				const response = await fetch(`http://127.0.0.1:${port}`);
				if (response.ok || response.status === 404) {
					return;
				}
			} catch {
				// Keep polling.
			}
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
	}

	throw new Error(`${label} timed out waiting for dev readiness.`);
}

function runBuildSmoke(label, cwd, extraArgs = []) {
	const commandLine = ['npm', 'run', 'build', '--', ...extraArgs].map(shellEscape).join(' ');
	const result = spawnSync('script', ['-qefc', commandLine, '/dev/null'], {
		cwd,
		env: { ...process.env, ...cacheEnv() },
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: 1800000,
	});
	const entry = {
		label,
		command: 'script',
		args: ['-qefc', commandLine, '/dev/null'],
		cwd,
		status: result.status ?? 1,
		signal: result.signal ?? null,
		durationMs: 0,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
	writeCommandArtifact(label, entry);
	if (entry.status !== 0) {
		throw new Error(`${label} failed with exit ${entry.status}.\n${entry.stdout}\n${entry.stderr}`.trim());
	}
	return entry;
}

function createManualPackageTarball(pkg) {
	const stageRoot = mkdtempSync(join(tmpdir(), 'treeseed-package-stage-'));
	const packageStageRoot = resolve(stageRoot, 'package');
	mkdirSync(packageStageRoot, { recursive: true });

	for (const entry of ['package.json', 'README.md', ...(pkg.packageJson.files ?? [])]) {
		const sourcePath = resolve(pkg.dir, entry);
		const targetPath = resolve(packageStageRoot, entry);
		cpSync(sourcePath, targetPath, { recursive: true });
	}

	const tarballPath = resolve(tmpdir(), `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.packageJson.version}-e2e.tgz`);
	run('tar', ['-czf', tarballPath, '-C', stageRoot, 'package'], { cwd: root });
	return {
		packageName: pkg.name,
		tarballPath,
		stageRoot,
	};
}
