import { spawn } from 'node:child_process';
import { resolveTreeseedToolCommand } from '../../managed-dependencies.ts';
import { withTreeseedServiceCredentialEnv } from '../../service-credentials.ts';

type RailwayCliInput = {
	args: string[];
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	cwd?: string;
	stdin?: string;
	timeoutMs?: number;
};

export async function runRailwayCliJson<T = unknown>({ args, env = process.env, cwd = process.cwd(), stdin, timeoutMs = 60_000 }: RailwayCliInput): Promise<T> {
	const effectiveEnv = withTreeseedServiceCredentialEnv(env);
	const command = resolveTreeseedToolCommand('railway', { env: effectiveEnv });
	if (!command) {
		throw new Error('The managed Railway CLI is unavailable. Run `npx trsd install --json` before retrying reconciliation.');
	}
	return await new Promise<T>((resolve, reject) => {
		const detached = process.platform !== 'win32';
		const child = spawn(command.command, [...command.argsPrefix, ...args], {
			cwd,
			env: effectiveEnv,
			stdio: ['pipe', 'pipe', 'pipe'],
			detached,
		});
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		let settled = false;
		let forceKill: NodeJS.Timeout | null = null;
		const killProcessTree = (signal: NodeJS.Signals) => {
			if (child.pid && detached) {
				try {
					process.kill(-child.pid, signal);
					return;
				} catch {
					// The process may have exited between observation and termination.
				}
			}
			child.kill(signal);
		};
		const timeout = setTimeout(() => {
			timedOut = true;
			killProcessTree('SIGTERM');
			forceKill = setTimeout(() => killProcessTree('SIGKILL'), 2_000);
		}, timeoutMs);
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (forceKill) clearTimeout(forceKill);
			callback();
		};
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => { stdout += chunk; });
		child.stderr.on('data', (chunk) => { stderr += chunk; });
		child.on('error', (error) => finish(() => reject(error)));
		child.on('close', (code) => {
			finish(() => {
				if (timedOut) {
					reject(new Error(`Railway CLI timed out after ${timeoutMs}ms: railway ${args.join(' ')}`));
					return;
				}
				if (code !== 0) {
					reject(new Error(`Railway CLI failed (${code ?? 'signal'}): ${stderr.trim() || stdout.trim() || args[0]}`));
					return;
				}
				try {
					resolve(stdout.trim() ? JSON.parse(stdout) as T : {} as T);
				} catch (error) {
					reject(new Error(`Railway CLI returned invalid JSON for ${args.join(' ')}: ${error instanceof Error ? error.message : String(error)}`));
				}
			});
		});
		if (stdin !== undefined) child.stdin.end(stdin);
		else child.stdin.end();
	});
}

function volumeScope(projectId: string, environmentId: string, serviceId?: string) {
	return ['volume', '--project', projectId, '--environment', environmentId, ...(serviceId ? ['--service', serviceId] : [])];
}

export async function deleteRailwayVolumeWithCli(input: {
	projectId: string;
	environmentId: string;
	volumeId: string;
	env?: NodeJS.ProcessEnv;
}) {
	return runRailwayCliJson({
		args: [...volumeScope(input.projectId, input.environmentId), 'delete', '--volume', input.volumeId, '--yes', '--json'],
		env: input.env,
	});
}

export async function detachRailwayVolumeWithCli(input: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	volumeId: string;
	env?: NodeJS.ProcessEnv;
}) {
	return runRailwayCliJson({
		args: [...volumeScope(input.projectId, input.environmentId, input.serviceId), 'detach', '--volume', input.volumeId, '--yes', '--json'],
		env: input.env,
	});
}

export async function attachRailwayVolumeWithCli(input: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	volumeId: string;
	env?: NodeJS.ProcessEnv;
}) {
	return runRailwayCliJson({
		args: [...volumeScope(input.projectId, input.environmentId, input.serviceId), 'attach', '--volume', input.volumeId, '--yes', '--json'],
		env: input.env,
	});
}

export async function updateRailwayVolumeWithCli(input: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	volumeId: string;
	name: string;
	mountPath: string;
	env?: NodeJS.ProcessEnv;
}) {
	return runRailwayCliJson({
		args: [
			...volumeScope(input.projectId, input.environmentId, input.serviceId),
			'update', '--volume', input.volumeId, '--name', input.name, '--mount-path', input.mountPath, '--json',
		],
		env: input.env,
	});
}

export async function connectRailwayServiceSourceWithCli(input: {
	projectId?: string | null;
	environmentId: string;
	serviceId: string;
	repo?: string | null;
	branch?: string | null;
	image?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}) {
	const repo = String(input.repo ?? '').trim();
	const image = String(input.image ?? '').trim();
	if (Boolean(repo) === Boolean(image)) {
		throw new Error('Railway service source connection requires exactly one GitHub repository or image reference.');
	}
	return runRailwayCliJson({
		args: [
			'service', 'source', 'connect',
			...(String(input.projectId ?? '').trim() ? ['--project', String(input.projectId).trim()] : []),
			'--environment', input.environmentId,
			'--service', input.serviceId,
			...(repo ? ['--repo', repo] : ['--image', image]),
			...(repo && String(input.branch ?? '').trim() ? ['--branch', String(input.branch).trim()] : []),
			'--json',
		],
		env: input.env,
	});
}
