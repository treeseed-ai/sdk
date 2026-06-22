import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { sortWorkspacePackages, workspacePackages, workspaceRoot, run } from '../src/operations/services/workspace-tools.ts';

const packages = sortWorkspacePackages(workspacePackages());
const root = workspaceRoot();

type ProcessInfo = {
	pid: number;
	fdCount: number | null;
	command: string;
};

function readProcessCommand(pid: string) {
	try {
		return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
			|| readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
	} catch {
		return '';
	}
}

function processFdCount(pid: string) {
	try {
		return readdirSync(`/proc/${pid}/fd`).length;
	} catch {
		return null;
	}
}

function runningProcesses(): ProcessInfo[] {
	if (!existsSync('/proc')) {
		return [];
	}
	return readdirSync('/proc')
		.filter((entry) => /^\d+$/u.test(entry))
		.map((pid) => ({
			pid: Number(pid),
			fdCount: processFdCount(pid),
			command: readProcessCommand(pid),
		}))
		.filter((entry) => entry.command.length > 0);
}

function terminate(pid: number, signal: NodeJS.Signals) {
	try {
		process.kill(pid, signal);
		return true;
	} catch {
		return false;
	}
}

function cleanupStaleWorkspaceVerificationProcesses() {
	const normalizedRoot = resolve(root);
	const stale = runningProcesses().filter((entry) => {
		const command = entry.command;
		if (!command.includes('/.treeseed/worktrees/') || command.includes(normalizedRoot)) {
			return false;
		}
		return /(vitest|release-verify|src\/verification\.ts|workspace-release-test)/u.test(command);
	});

	if (stale.length === 0) {
		return;
	}

	process.stderr.write(`[workspace-release-test] stopping ${stale.length} stale sibling worktree verification process(es) before release tests\n`);
	for (const entry of stale) {
		process.stderr.write(`[workspace-release-test] SIGTERM stale pid ${entry.pid}: ${entry.command.slice(0, 180)}\n`);
		terminate(entry.pid, 'SIGTERM');
	}

	spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { stdio: 'ignore' });

	for (const entry of stale) {
		try {
			process.kill(entry.pid, 0);
			process.stderr.write(`[workspace-release-test] SIGKILL stale pid ${entry.pid}: ${entry.command.slice(0, 180)}\n`);
			terminate(entry.pid, 'SIGKILL');
		} catch {
			// Process exited after SIGTERM.
		}
	}
}

function writeFdDiagnostic(label: string) {
	const rows = runningProcesses()
		.filter((entry) => (entry.fdCount ?? 0) >= 80)
		.sort((left, right) => (right.fdCount ?? 0) - (left.fdCount ?? 0))
		.slice(0, 10);
	if (rows.length === 0) {
		process.stderr.write(`[workspace-release-test] fd ${label}: no process with >=80 open descriptors\n`);
		return;
	}
	process.stderr.write(`[workspace-release-test] fd ${label}: ${rows.map((entry) => `${entry.pid}:${entry.fdCount}:${entry.command.slice(0, 80)}`).join(' | ')}\n`);
}

cleanupStaleWorkspaceVerificationProcesses();
writeFdDiagnostic('before');

for (const pkg of packages) {
	const scripts = pkg.packageJson.scripts ?? {};
	const scriptName = typeof scripts['test:release'] === 'string'
		? 'test:release'
		: typeof scripts['test:unit'] === 'string'
			? 'test:unit'
			: typeof scripts.test === 'string'
				? 'test'
				: null;

	if (scriptName) {
		const startedAt = Date.now();
		process.stderr.write(`[workspace-release-test] ${pkg.name ?? pkg.dir} ${scriptName} start\n`);
		run('npm', ['run', scriptName], { cwd: pkg.dir });
		process.stderr.write(`[workspace-release-test] ${pkg.name ?? pkg.dir} ${scriptName} complete after ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
		writeFdDiagnostic(`after ${pkg.name ?? pkg.dir}`);
	}
}
