import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dockerBuildHeadroomBytes, observeLocalDiskCapacity } from './local-disk-capacity.ts';

export type DockerCommandResult = {
	ok: boolean;
	status: number | null;
	stdout: string;
	stderr: string;
	args: string[];
};

function runDocker(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): DockerCommandResult {
	const result = spawnSync('docker', args, {
		cwd: options.cwd,
		env: { ...process.env, ...(options.env ?? {}) },
		encoding: 'utf8',
	});
	return {
		ok: (result.status ?? 1) === 0,
		status: result.status,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		args,
	};
}

function pruneBuildCache(input: { pressure: boolean; requiredAvailableBytes?: number }) {
	const args = input.pressure
		? ['buildx', 'prune', '--force', '--min-free-space', String(input.requiredAvailableBytes ?? 0), '--reserved-space', '1GB', '--max-used-space', '4GB']
		: ['buildx', 'prune', '--force', '--filter', 'until=24h', '--reserved-space', '2GB', '--max-used-space', '8GB'];
	return runDocker(args);
}

export function inspectDockerAvailability() {
	const version = runDocker(['version', '--format', '{{.Server.Version}}']);
	const buildx = runDocker(['buildx', 'version']);
	return {
		available: version.ok,
		buildxAvailable: buildx.ok,
		version: version.stdout.trim() || null,
		buildx: buildx.stdout.trim() || null,
		warnings: [
			...(version.ok ? [] : ['Docker is not available in this shell']),
			...(buildx.ok ? [] : ['Docker Buildx is not available in this shell']),
		],
	};
}

export function inspectDockerImage(tag: string) {
	const result = runDocker(['image', 'inspect', tag]);
	if (!result.ok) return null;
	try {
		const parsed = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
		return parsed[0] ?? null;
	} catch {
		return { raw: result.stdout };
	}
}

export function inspectDockerManifest(ref: string) {
	const result = runDocker(['buildx', 'imagetools', 'inspect', ref]);
	return result.ok ? { ref, output: result.stdout } : null;
}

export function buildDockerImage(input: {
	tenantRoot: string;
	packageRoot: string;
	context: string;
	dockerfile: string;
	target?: string | null;
	platforms: string[];
	tags: string[];
	labels?: Record<string, string>;
	buildArgs?: Record<string, string>;
	push?: boolean;
	load?: boolean;
	provenance?: boolean;
	env?: NodeJS.ProcessEnv;
}) {
	const packageRoot = resolve(input.packageRoot);
	const contextPath = resolve(packageRoot, input.context || '.');
	const dockerfilePath = resolve(packageRoot, input.dockerfile || 'Dockerfile');
	if (!existsSync(dockerfilePath)) {
		throw new Error(`Dockerfile does not exist: ${dockerfilePath}`);
	}
	const headroomBytes = dockerBuildHeadroomBytes({ contextPath, env: input.env });
	let diskCapacity = observeLocalDiskCapacity({ path: packageRoot, operationHeadroomBytes: headroomBytes, env: input.env });
	let pressurePrune: DockerCommandResult | null = null;
	if (!diskCapacity.ok) {
		pressurePrune = pruneBuildCache({ pressure: true, requiredAvailableBytes: diskCapacity.requiredAvailableBytes });
		diskCapacity = observeLocalDiskCapacity({ path: packageRoot, operationHeadroomBytes: headroomBytes, env: input.env });
	}
	if (!diskCapacity.ok) throw new Error(diskCapacity.reason ?? 'disk-capacity-insufficient');
	const args = [
		'buildx',
		'build',
		'--file',
		dockerfilePath,
		'--platform',
		input.platforms.join(','),
		...(input.target ? ['--target', input.target] : []),
		...input.tags.flatMap((tag) => ['--tag', tag]),
		...Object.entries(input.labels ?? {}).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
		...Object.entries(input.buildArgs ?? {}).flatMap(([key, value]) => ['--build-arg', `${key}=${value}`]),
		...(input.push ? ['--push'] : []),
		...(input.load ? ['--load'] : []),
		...(input.provenance === false ? ['--provenance=false'] : []),
		contextPath,
	];
	const result = runDocker(args, { cwd: packageRoot, env: input.env });
	if (!result.ok) {
		pruneBuildCache({ pressure: true, requiredAvailableBytes: diskCapacity.requiredAvailableBytes });
		throw new Error(result.stderr.trim() || result.stdout.trim() || `docker ${args.join(' ')} failed`);
	}
	const cachePrune = pruneBuildCache({ pressure: false });
	return {
		...result,
		contextPath,
		dockerfilePath,
		tags: input.tags,
		platforms: input.platforms,
		diskCapacity,
		pressurePrune,
		cachePrune,
	};
}

export function buildDockerComposeArgs(input: {
	composeFile?: string;
	composeFiles?: string[];
	projectName: string;
	services?: string[];
	profiles?: string[];
	buildPolicy?: 'never' | 'missing' | 'always';
	removeVolumes?: boolean;
	action: 'config' | 'ps' | 'up' | 'down' | 'restart' | 'logs';
}) {
	const composeFiles = input.composeFiles?.length ? input.composeFiles : input.composeFile ? [input.composeFile] : [];
	const profileArgs = (input.profiles ?? []).flatMap((profile) => ['--profile', profile]);
	const buildArgs = input.buildPolicy === 'always'
		? ['--build']
		: input.buildPolicy === 'never'
			? ['--no-build']
			: [];
	const base = [
		'compose',
		...profileArgs,
		...composeFiles.flatMap((composeFile) => ['-f', composeFile]),
		'-p',
		input.projectName,
	];
	const services = (input.services ?? []).filter((service) => service.trim().length > 0);
	return input.action === 'config'
		? [...base, 'config', '--hash', '*']
		: input.action === 'ps'
			? [...base, 'ps', '--format', 'json']
			: input.action === 'up'
				? [...base, 'up', '-d', ...buildArgs, ...services]
				: input.action === 'down'
					? [...base, 'down', ...(input.removeVolumes ? ['--volumes', '--remove-orphans'] : [])]
					: input.action === 'restart'
						? [...base, 'up', '-d', ...buildArgs, '--force-recreate', ...services]
						: [...base, 'logs', '--tail', '200'];
}

export function runDockerCompose(input: {
	composeFile?: string;
	composeFiles?: string[];
	projectName: string;
	services?: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
	profiles?: string[];
	buildPolicy?: 'never' | 'missing' | 'always';
	removeVolumes?: boolean;
	action: 'config' | 'ps' | 'up' | 'down' | 'restart' | 'logs';
}) {
	const args = buildDockerComposeArgs(input);
	return runDocker(args, { cwd: input.cwd, env: input.env });
}

export function repairDockerComposeDataOwnership(input: {
	composeFiles: string[];
	projectName: string;
	service: string;
	cwd: string;
	env?: NodeJS.ProcessEnv;
	uid: number;
	gid: number;
}) {
	if (!Number.isSafeInteger(input.uid) || input.uid < 0 || !Number.isSafeInteger(input.gid) || input.gid < 0) {
		throw new Error('Docker Compose data ownership repair requires numeric host uid and gid values.');
	}
	const args = [
		'compose',
		...input.composeFiles.flatMap((composeFile) => ['-f', composeFile]),
		'-p',
		input.projectName,
		'run',
		'--rm',
		'--no-deps',
		'--entrypoint',
		'chown',
		input.service,
		'-R',
		`${input.uid}:${input.gid}`,
		'/data',
	];
	return runDocker(args, { cwd: input.cwd, env: input.env });
}
