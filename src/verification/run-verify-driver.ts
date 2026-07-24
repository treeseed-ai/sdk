import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as childProcess from 'node:child_process';
import { basename, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createManagedToolEnv, resolveToolBinary } from '../entrypoints/runtime/managed-dependencies.ts';
import { VerifyDriverOptions, check, createActArgs, defaultWrite, run, runActCommand } from './verify-driver.ts';
import { createWorkspaceActWorkflow, getVerifyDriverStatus } from './create-workspace-act-workflow.ts';

export function runVerifyDriver(options: VerifyDriverOptions = {}) {
	const write = options.write ?? defaultWrite;
	const status = getVerifyDriverStatus(options);
	const runCommand = options.runCommand ?? run;
	const checkCommand = options.checkCommand ?? check;
	const gh = options.runCommand || options.checkCommand ? 'gh' : (resolveToolBinary('gh') ?? 'gh');

	if (status.driver === 'direct' || status.inGitHubActions) {
		return runCommand('npm', ['run', 'verify:direct'], status.packageRoot);
	}

	if (status.driver === 'act') {
		if (!status.workflowPresent) {
			write(`Treeseed verify requires ${status.workflowPath} when TREESEED_VERIFY_DRIVER=act.`, 'stderr');
			return 1;
		}
		if (!status.ghActAvailable) {
			const detail = checkCommand(gh, ['act', '--version'], status.packageRoot).detail;
			write(detail || 'Treeseed verify requires `gh act` when TREESEED_VERIFY_DRIVER=act.', 'stderr');
			return 1;
		}
		if (!status.dockerAvailable) {
			const detail = checkCommand('docker', ['info'], status.packageRoot).detail;
			write(detail || 'Treeseed verify requires a running Docker daemon when TREESEED_VERIFY_DRIVER=act.', 'stderr');
			return 1;
		}
		if (status.workspaceRoot && status.localSiblingDependencies.length > 0) {
			const workspaceAct = createWorkspaceActWorkflow({
				workspaceRoot: status.workspaceRoot,
				packageRoot: status.packageRoot,
				eventName: status.eventName,
				localSiblingDependencies: status.localSiblingDependencies,
			});
			return runActCommand(runCommand, gh, workspaceAct.args, workspaceAct.cwd);
		}
		return runActCommand(runCommand, gh, createActArgs(status.eventName, '.github/workflows/verify.yml'), status.packageRoot);
	}

	if (status.prefersDirectForLocalWorkspace) {
		return runCommand('npm', ['run', 'verify:direct'], status.packageRoot);
	}

	if (status.canUseAct) {
		return runActCommand(runCommand, gh, createActArgs(status.eventName, '.github/workflows/verify.yml'), status.packageRoot);
	}

	if (!status.workflowPresent) {
		write('Treeseed verify warning: package-local verify workflow is missing; falling back to verify:direct.', 'stderr');
	} else if (!status.ghActAvailable) {
		write('Treeseed verify warning: `gh act` is unavailable; falling back to verify:direct.', 'stderr');
	} else if (!status.dockerAvailable) {
		write('Treeseed verify warning: Docker is unavailable; falling back to verify:direct.', 'stderr');
	}

	return runCommand('npm', ['run', 'verify:direct'], status.packageRoot);
}

export const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';

export const invokedBasename = basename(invokedPath);

export const modulePath = fileURLToPath(import.meta.url);

export const moduleBasename = basename(modulePath);

export const invokedAsVerificationEntrypoint =
	invokedPath === modulePath ||
	/^verification\.(?:ts|js|mjs|cjs)$/.test(invokedBasename) ||
	invokedBasename === moduleBasename;

if (invokedAsVerificationEntrypoint) {
	process.exit(runVerifyDriver());
}
