import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type TreeseedVerifyDriver = 'auto' | 'act' | 'direct';

export type TreeseedVerifyDriverOptions = {
	packageRoot?: string;
	driver?: TreeseedVerifyDriver;
	eventName?: string;
	write?: (message: string, stream?: 'stdout' | 'stderr') => void;
};

export type TreeseedVerifyDriverStatus = {
	packageRoot: string;
	workflowPath: string;
	driver: TreeseedVerifyDriver;
	eventName: string;
	inGitHubActions: boolean;
	workflowPresent: boolean;
	ghActAvailable: boolean;
	dockerAvailable: boolean;
	canUseAct: boolean;
};

function defaultWrite(message: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!message) return;
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${message}\n`);
}

function run(command: string, args: string[], cwd: string) {
	const result = spawnSync(command, args, {
		cwd,
		env: process.env,
		stdio: 'inherit',
	});
	return result.status ?? 1;
}

function check(command: string, args: string[], cwd: string) {
	const result = spawnSync(command, args, {
		cwd,
		env: process.env,
		stdio: 'pipe',
		encoding: 'utf8',
	});
	return {
		ok: result.status === 0,
		detail: `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim(),
	};
}

export function getTreeseedVerifyDriverStatus(options: TreeseedVerifyDriverOptions = {}): TreeseedVerifyDriverStatus {
	const packageRoot = resolve(options.packageRoot ?? process.cwd());
	const workflowPath = resolve(packageRoot, '.github', 'workflows', 'verify.yml');
	const driver = options.driver ?? (process.env.TREESEED_VERIFY_DRIVER as TreeseedVerifyDriver | undefined) ?? 'auto';
	const eventName = options.eventName ?? process.env.TREESEED_VERIFY_EVENT ?? 'workflow_dispatch';
	const inGitHubActions = process.env.GITHUB_ACTIONS === 'true';
	const workflowPresent = existsSync(workflowPath);
	const ghAct = check('gh', ['act', '--version'], packageRoot);
	const docker = check('docker', ['info'], packageRoot);

	return {
		packageRoot,
		workflowPath,
		driver,
		eventName,
		inGitHubActions,
		workflowPresent,
		ghActAvailable: ghAct.ok,
		dockerAvailable: docker.ok,
		canUseAct: workflowPresent && ghAct.ok && docker.ok,
	};
}

export function runTreeseedVerifyDriver(options: TreeseedVerifyDriverOptions = {}) {
	const write = options.write ?? defaultWrite;
	const status = getTreeseedVerifyDriverStatus(options);

	if (status.driver === 'direct' || status.inGitHubActions) {
		return run('npm', ['run', 'verify:direct'], status.packageRoot);
	}

	if (status.driver === 'act') {
		if (!status.workflowPresent) {
			write(`Treeseed verify requires ${status.workflowPath} when TREESEED_VERIFY_DRIVER=act.`, 'stderr');
			return 1;
		}
		if (!status.ghActAvailable) {
			const detail = check('gh', ['act', '--version'], status.packageRoot).detail;
			write(detail || 'Treeseed verify requires `gh act` when TREESEED_VERIFY_DRIVER=act.', 'stderr');
			return 1;
		}
		if (!status.dockerAvailable) {
			const detail = check('docker', ['info'], status.packageRoot).detail;
			write(detail || 'Treeseed verify requires a running Docker daemon when TREESEED_VERIFY_DRIVER=act.', 'stderr');
			return 1;
		}
		return run('gh', ['act', status.eventName, '-W', '.github/workflows/verify.yml', '-j', 'verify'], status.packageRoot);
	}

	if (status.canUseAct) {
		return run('gh', ['act', status.eventName, '-W', '.github/workflows/verify.yml', '-j', 'verify'], status.packageRoot);
	}

	if (!status.workflowPresent) {
		write('Treeseed verify warning: package-local verify workflow is missing; falling back to verify:direct.', 'stderr');
	} else if (!status.ghActAvailable) {
		write('Treeseed verify warning: `gh act` is unavailable; falling back to verify:direct.', 'stderr');
	} else if (!status.dockerAvailable) {
		write('Treeseed verify warning: Docker is unavailable; falling back to verify:direct.', 'stderr');
	}

	return run('npm', ['run', 'verify:direct'], status.packageRoot);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(runTreeseedVerifyDriver());
}
