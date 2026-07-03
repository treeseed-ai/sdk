import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runRailwayIac, type RailwayChangeSet, type RailwayIacApplyResponse, type RailwayIacPlanResponse } from 'railway/iac';

export type TreeseedRailwayIacService = {
	key: string;
	serviceName: string;
	sourceMode?: string | null;
	sourceRepo?: string | null;
	sourceBranch?: string | null;
	sourceCommit?: string | null;
	sourceRootDirectory?: string | null;
	imageRef?: string | null;
	dockerfilePath?: string | null;
	buildCommand?: string | null;
	startCommand?: string | null;
	healthcheckPath?: string | null;
	healthcheckTimeoutSeconds?: number | null;
	runtimeMode?: string | null;
	volumeMountPath?: string | null;
	variables?: Record<string, string>;
	secrets?: Record<string, string>;
	detachVolumeIds?: string[];
};

export type TreeseedRailwayIacDatabase = {
	serviceName: string;
	environmentVariable: string;
	mountPath?: string | null;
	detachVolumeIds?: string[];
	useNativePostgres?: boolean;
};

export type TreeseedRailwayIacProjectInput = {
	tenantRoot: string;
	projectName: string;
	projectId: string;
	environmentName: string;
	environmentId: string;
	railwayApiToken: string;
	railwayApiUrl?: string | null;
	services: TreeseedRailwayIacService[];
	database: TreeseedRailwayIacDatabase | null;
	region?: string | null;
};

export type TreeseedRailwayIacRenderResult = {
	filePath: string;
	tempDir: string;
	projectName: string;
	environmentName: string;
	serviceNames: string[];
	volumeNames: string[];
	databaseName: string | null;
	source: string;
};

export type RailwayIacValidationResult = {
	ok: boolean;
	destructiveChanges: string[];
	blockedReasons: string[];
	allowedDrift: string[];
};

function js(value: unknown) {
	return JSON.stringify(value);
}

function id(prefix: string, index: number) {
	return `${prefix}${index}`;
}

function codeObject(entries: Array<[string, string | null | undefined]>) {
	const rendered = entries
		.filter(([, value]) => typeof value === 'string' && value.length > 0)
		.map(([key, value]) => `${js(key)}: ${value}`);
	return rendered.length > 0 ? `{\n${rendered.map((line) => `      ${line}`).join(',\n')}\n    }` : '{}';
}

function literalVariable(value: string) {
	return js(value);
}

function validateGeneratedVariables(service: TreeseedRailwayIacService) {
	const keys = [...Object.keys(service.variables ?? {}), ...Object.keys(service.secrets ?? {})];
	const isTreeDxService = service.serviceName.includes('treedx') || service.key.includes('treedx');
	return keys.filter((key) => {
		if (key === 'PORT') return false;
		if (key.startsWith('TREESEED_')) return false;
		if (isTreeDxService && key.startsWith('TREEDX_')) return false;
		return true;
	});
}

function serviceSource(service: TreeseedRailwayIacService) {
	if (service.imageRef) {
		return `image(${js(service.imageRef)})`;
	}
	if (service.sourceMode === 'git' && service.sourceRepo) {
		const sourceConfig = {
			...(service.sourceBranch ? { branch: service.sourceBranch } : {}),
			...(service.sourceRootDirectory ? { rootDirectory: service.sourceRootDirectory } : {}),
			...(service.sourceCommit ? { commitSha: service.sourceCommit } : {}),
		};
		return `github(${js(service.sourceRepo)}, ${js(sourceConfig)})`;
	}
	return 'empty()';
}

function buildConfig(service: TreeseedRailwayIacService) {
	if (service.imageRef) return null;
	if (service.dockerfilePath) {
		return {
			builder: 'DOCKERFILE',
			dockerfilePath: service.dockerfilePath,
		};
	}
	if (service.buildCommand) {
		return {
			builder: 'NIXPACKS',
			buildCommand: service.buildCommand,
		};
	}
	return null;
}

function deployConfig(service: TreeseedRailwayIacService, region: string) {
	const runtimeMode = String(service.runtimeMode ?? '').trim();
	const deploy = {
		...(service.startCommand ? { startCommand: service.startCommand } : {}),
		...(service.healthcheckPath ? { healthcheckPath: service.healthcheckPath } : {}),
		...(service.healthcheckTimeoutSeconds ? { healthcheckTimeout: service.healthcheckTimeoutSeconds } : {}),
		...(runtimeMode === 'serverless' ? { sleepApplication: true } : {}),
		...(runtimeMode === 'service' || runtimeMode === 'replicated' ? { sleepApplication: false } : {}),
		...(service.volumeMountPath ? { requiredMountPath: service.volumeMountPath } : {}),
		region,
	};
	return Object.keys(deploy).length > 0 ? deploy : null;
}

function renderServiceEnv(service: TreeseedRailwayIacService, databaseVariableName: string | null, databaseEnvName: string | null) {
	const variables = {
		...(service.variables ?? {}),
		...(service.secrets ?? {}),
	};
	const entries = Object.entries(variables)
		.filter(([key]) => key.startsWith('TREESEED_') || key.startsWith('TREEDX_') || key === 'PORT')
		.map(([key, value]) => {
			const dbRef = databaseVariableName && databaseEnvName && key === databaseEnvName;
			return [key, dbRef ? `${databaseVariableName}.env.DATABASE_URL` : literalVariable(value)] as [string, string];
		});
	return codeObject(entries);
}

function renderPostgresEnv() {
	return codeObject([
		['PGDATA', js('/var/lib/postgresql/data/pgdata')],
		['PGHOST', js('${{RAILWAY_PRIVATE_DOMAIN}}')],
		['PGPORT', js('5432')],
		['PGUSER', js('${{POSTGRES_USER}}')],
		['PGDATABASE', js('${{POSTGRES_DB}}')],
		['PGPASSWORD', js('${{POSTGRES_PASSWORD}}')],
		['POSTGRES_DB', js('railway')],
		['DATABASE_URL', js('postgresql://${{PGUSER}}:${{POSTGRES_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:5432/${{PGDATABASE}}')],
		['POSTGRES_USER', js('postgres')],
		['SSL_CERT_DAYS', js('820')],
		['POSTGRES_PASSWORD', '{ generator: "secret(32, \\"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ\\")" }'],
		['DATABASE_PUBLIC_URL', js('postgresql://${{PGUSER}}:${{POSTGRES_PASSWORD}}@${{RAILWAY_TCP_PROXY_DOMAIN}}:${{RAILWAY_TCP_PROXY_PORT}}/${{PGDATABASE}}')],
		['RAILWAY_DEPLOYMENT_DRAINING_SECONDS', js('60')],
	]);
}

export function renderRailwayIacProject(input: TreeseedRailwayIacProjectInput): TreeseedRailwayIacRenderResult {
	const region = input.region?.trim() || 'us-east4-eqdc4a';
	const tempParent = resolve(input.tenantRoot, '.treeseed', 'tmp');
	mkdirSync(tempParent, { recursive: true });
	const tempDir = mkdtempSync(resolve(tempParent, 'railway-iac-'));
	const filePath = resolve(tempDir, 'railway.mjs');
	const resources: string[] = [];
	const declarations: string[] = [];
	const volumeNames: string[] = [];
	const databaseVariableName = input.database ? 'db' : null;
	const databaseEnvName = input.database?.environmentVariable ?? null;
	if (input.database) {
		const postgresVolumeName = `${input.database.serviceName}-volume`;
		const postgresMountPath = input.database.mountPath?.trim() || '/var/lib/postgresql/data';
		volumeNames.push(postgresVolumeName);
		if (input.database.useNativePostgres) {
			declarations.push(`  const dbVolume = volume(${js(postgresVolumeName)}, ${js({
				region,
				sizeMB: 50000,
				allowOnlineResize: true,
				alerts: { usage: { 80: {}, 95: {}, 100: {} } },
			})});`);
			declarations.push(`  const db = postgres(${js(input.database.serviceName)}, ${js({ region })});`);
			resources.push('dbVolume', 'db');
		} else {
			const postgresMounts = [
				...(input.database.detachVolumeIds ?? []).map((volumeId) => `${js(volumeId)}: null`),
				`${js(postgresMountPath)}: dbVolume`,
			];
			declarations.push(`  const dbVolume = volume(${js(postgresVolumeName)}, ${js({
				region,
				sizeMB: 50000,
				allowOnlineResize: true,
				alerts: { usage: { 80: {}, 95: {}, 100: {} } },
			})});`);
			declarations.push(`  const db = service(${js(input.database.serviceName)}, {
    source: image("ghcr.io/railwayapp-templates/postgres-ssl:18"),
    env: ${renderPostgresEnv()},
    deploy: {
      requiredMountPath: ${js(postgresMountPath)},
      region: ${js(region)}
    },
    volumeMounts: { ${postgresMounts.join(', ')} }
  });`);
			resources.push('dbVolume', 'db');
		}
	}
	input.services.forEach((service, index) => {
		const serviceVar = id('svc', index);
		const invalidVariables = validateGeneratedVariables(service);
		if (invalidVariables.length > 0) {
			throw new Error(`Railway IaC service ${service.serviceName} has invalid generated variables: ${invalidVariables.join(', ')}.`);
		}
		const entries = [
			`source: ${serviceSource(service)}`,
			`env: ${renderServiceEnv(service, databaseVariableName, databaseEnvName)}`,
		];
		const build = buildConfig(service);
		const deploy = deployConfig(service, region);
		if (build) entries.push(`build: ${js(build)}`);
		if (deploy) entries.push(`deploy: ${js(deploy)}`);
		if (service.volumeMountPath) {
			const volumeName = `${service.serviceName}-volume`;
			const volumeVar = id('vol', index);
			const volumeMounts = [
				...(service.detachVolumeIds ?? []).map((volumeId) => `${js(volumeId)}: null`),
				`${js(service.volumeMountPath)}: ${volumeVar}`,
			];
			volumeNames.push(volumeName);
			declarations.push(`  const ${volumeVar} = volume(${js(volumeName)}, ${js({
				region,
				sizeMB: 50000,
				allowOnlineResize: true,
				alerts: { usage: { 80: {}, 95: {}, 100: {} } },
			})});`);
			entries.push(`volumeMounts: { ${volumeMounts.join(', ')} }`);
			resources.push(volumeVar);
		}
		declarations.push(`  const ${serviceVar} = service(${js(service.serviceName)}, {\n    ${entries.join(',\n    ')}\n  });`);
		resources.push(serviceVar);
	});
	const source = `
import { defineRailway, empty, github, image, postgres, project, service, volume, preserve } from "railway/iac";

export default defineRailway(() => {
${declarations.join('\n')}
  return project(${js(input.projectName)}, { resources: [${resources.join(', ')}] });
});
`.trimStart();
	writeFileSync(filePath, source);
	return {
		filePath,
		tempDir,
		projectName: input.projectName,
		environmentName: input.environmentName,
		serviceNames: input.services.map((service) => service.serviceName),
		volumeNames,
		databaseName: input.database?.serviceName ?? null,
		source,
	};
}

function changeName(change: any) {
	return String(change?.resource?.name ?? change?.previous?.name ?? change?.address ?? change?.path ?? '');
}

function changeFieldText(change: any) {
	return [
		change?.field,
		change?.path,
		change?.address,
		change?.summary,
	].map((value) => String(value ?? '').toLowerCase()).join(' ');
}

function isRailwaySourceChange(change: any) {
	const field = String(change?.field ?? '').toLowerCase();
	const path = String(change?.path ?? '').toLowerCase();
	const summary = String(change?.summary ?? '').toLowerCase();
	return field === 'source'
		|| /\.source\b/u.test(path)
		|| (/source/u.test(summary) && !/\b(env|environment|variable|variables)\b/u.test(summary));
}

function isRailwayImageSourceChange(change: any) {
	if (!isRailwaySourceChange(change)) return false;
	return /image|docker-image/u.test(changeFieldText(change));
}

function isRailwayGitSourceChange(change: any) {
	if (!isRailwaySourceChange(change)) return false;
	return /github|repo|branch/u.test(changeFieldText(change));
}

export function validateRailwayIacChangeSet(changeSet: RailwayChangeSet | undefined, desiredNames: {
	services: string[];
	volumes: string[];
	database: string | null;
	scope: string;
	serviceSourceModes?: Record<string, string | null | undefined>;
}): RailwayIacValidationResult {
	const blockedReasons: string[] = [];
	const destructiveChanges: string[] = [];
	const desired = new Set([...desiredNames.services, ...desiredNames.volumes, ...(desiredNames.database ? [desiredNames.database] : [])]);
	const created = new Set((changeSet?.changes ?? [])
		.filter((change) => change.kind === 'resource.create')
		.map((change) => changeName(change)));
	for (const change of changeSet?.changes ?? []) {
		const name = changeName(change);
		const sourceMode = desiredNames.serviceSourceModes?.[name]
			?? desiredNames.serviceSourceModes?.[name.replace(/^(service|database)\./u, '')]
			?? null;
		if (change.kind === 'resource.delete') {
			destructiveChanges.push(change.summary);
			blockedReasons.push(`Railway IaC plan would delete resource ${name || change.summary}; hosting reconciliation only updates or creates resources. Use the explicit destroy workflow for deletions.`);
			if (desired.has(name) && !created.has(name)) {
				blockedReasons.push(`Railway IaC plan would delete desired resource ${name}.`);
			}
		}
		if (desiredNames.scope === 'staging' && change.kind === 'resource.update' && isRailwayImageSourceChange(change) && (!sourceMode || sourceMode === 'image')) {
			blockedReasons.push(`Railway IaC plan would switch staging resource ${name} to an image source.`);
		}
		if (desiredNames.scope === 'prod' && change.kind === 'resource.update' && isRailwayGitSourceChange(change) && (!sourceMode || sourceMode === 'git')) {
			blockedReasons.push(`Railway IaC plan would switch production resource ${name} to a Git source.`);
		}
	}
	return {
		ok: blockedReasons.length === 0,
		destructiveChanges,
		blockedReasons,
		allowedDrift: [],
	};
}

export async function planRailwayIacProject(input: TreeseedRailwayIacProjectInput, rendered = renderRailwayIacProject(input)): Promise<RailwayIacPlanResponse> {
	return runRailwayIac({
		command: 'plan',
		cwd: rendered.tempDir,
		file: rendered.filePath,
		backboard: {
			endpoint: input.railwayApiUrl?.trim() || undefined,
			token: input.railwayApiToken,
			authType: 'bearer',
			projectId: input.projectId,
			environmentId: input.environmentId,
			decryptVariables: false,
			merge: true,
		},
	}) as Promise<RailwayIacPlanResponse>;
}

export async function applyRailwayIacProject(input: TreeseedRailwayIacProjectInput, rendered = renderRailwayIacProject(input)): Promise<RailwayIacApplyResponse> {
	return runRailwayIac({
		command: 'apply',
		cwd: rendered.tempDir,
		file: rendered.filePath,
		backboard: {
			endpoint: input.railwayApiUrl?.trim() || undefined,
			token: input.railwayApiToken,
			authType: 'bearer',
			projectId: input.projectId,
			environmentId: input.environmentId,
			decryptVariables: false,
			merge: true,
		},
	}) as Promise<RailwayIacApplyResponse>;
}

export function cleanupRailwayIacRender(rendered: Pick<TreeseedRailwayIacRenderResult, 'tempDir'>) {
	rmSync(rendered.tempDir, { recursive: true, force: true });
}
