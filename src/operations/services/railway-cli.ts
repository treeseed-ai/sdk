import { spawn } from 'node:child_process';
import { resolveTreeseedToolCommand } from '../../managed-dependencies.ts';
import { withTreeseedServiceCredentialEnv } from '../../service-credentials.ts';

type RailwayCliInput = {
	args: string[];
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	stdin?: string;
};

export async function runRailwayCliJson<T = unknown>({ args, env = process.env, cwd = process.cwd(), stdin }: RailwayCliInput): Promise<T> {
	const effectiveEnv = withTreeseedServiceCredentialEnv(env);
	const command = resolveTreeseedToolCommand('railway', { env: effectiveEnv });
	if (!command) {
		throw new Error('The managed Railway CLI is unavailable. Run `npx trsd install --json` before retrying reconciliation.');
	}
	return await new Promise<T>((resolve, reject) => {
		const child = spawn(command.command, [...command.argsPrefix, ...args], {
			cwd,
			env: effectiveEnv,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => { stdout += chunk; });
		child.stderr.on('data', (chunk) => { stderr += chunk; });
		child.on('error', reject);
		child.on('close', (code) => {
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
