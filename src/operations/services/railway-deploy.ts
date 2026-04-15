import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCliDeployConfig } from './runtime-tools.ts';

function normalizeScope(scope) {
	return scope === 'prod' ? 'prod' : scope === 'staging' ? 'staging' : 'local';
}
const RAILWAY_SERVICE_KEYS = ['api', 'agents', 'manager', 'worker', 'runner', 'workdayStart', 'workdayReport'];

function runRailway(args, { cwd, capture = false, allowFailure = false } = {}) {
	const result = spawnSync('railway', args, {
		cwd,
		stdio: capture ? 'pipe' : 'inherit',
		encoding: 'utf8',
		env: { ...process.env },
	});

	if (result.status !== 0 && !allowFailure) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `railway ${args.join(' ')} failed`);
	}

	return result;
}

export function configuredRailwayServices(tenantRoot, scope) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const normalizedScope = normalizeScope(scope);

	return RAILWAY_SERVICE_KEYS
		.map((serviceKey) => {
			const service = deployConfig.services?.[serviceKey];
			if (!service || service.enabled === false || (service.provider ?? 'railway') !== 'railway') {
				return null;
			}

			const defaultRootDir = ['api', 'manager', 'worker', 'runner', 'workdayStart', 'workdayReport'].includes(serviceKey) ? '.' : 'packages/core';
			const serviceRoot = resolve(tenantRoot, service.railway?.rootDir ?? service.rootDir ?? defaultRootDir);
			const railwayEnvironment = service.environments?.[normalizedScope]?.railwayEnvironment ?? normalizedScope;
			const publicBaseUrl = service.environments?.[normalizedScope]?.baseUrl ?? service.publicBaseUrl ?? null;
			return {
				key: serviceKey,
				scope: normalizedScope,
				projectId: service.railway?.projectId ?? null,
				projectName: service.railway?.projectName ?? null,
				serviceId: service.railway?.serviceId ?? null,
				serviceName: service.railway?.serviceName ?? null,
				rootDir: serviceRoot,
				publicBaseUrl,
				railwayEnvironment,
				buildCommand: service.railway?.buildCommand ?? null,
				startCommand: service.railway?.startCommand ?? null,
			};
		})
		.filter(Boolean);
}

export function validateRailwayServiceConfiguration(tenantRoot, scope) {
	const services = configuredRailwayServices(tenantRoot, scope);
	const issues = [];

	for (const service of services) {
		if (!service.serviceName && !service.serviceId) {
			issues.push(`${service.key}: set railway.serviceName or railway.serviceId in treeseed.site.yaml.`);
		}
		if (!service.projectName && !service.projectId) {
			issues.push(`${service.key}: set railway.projectName or railway.projectId in treeseed.site.yaml.`);
		}
		if (!existsSync(service.rootDir)) {
			issues.push(`${service.key}: service root ${service.rootDir} does not exist.`);
		}
	}

	if (issues.length > 0) {
		throw new Error(`Railway service configuration is incomplete:\n- ${issues.join('\n- ')}`);
	}

	return services;
}

export function validateRailwayDeployPrerequisites(tenantRoot, scope) {
	const services = validateRailwayServiceConfiguration(tenantRoot, scope);
	const token = process.env.RAILWAY_API_TOKEN;
	if (typeof token !== 'string' || token.trim().length === 0) {
		throw new Error('Configure RAILWAY_API_TOKEN before deploying Railway-managed services.');
	}
	return services;
}

export function planRailwayServiceDeploy(service) {
	const args = ['up', '--service', service.serviceName ?? service.serviceId, '--ci'];
	if (service.railwayEnvironment) {
		args.push('--environment', service.railwayEnvironment);
	}
	return {
		command: 'railway',
		args,
		cwd: service.rootDir,
	};
}

export function deployRailwayService(tenantRoot, service, { dryRun = false } = {}) {
	const plan = planRailwayServiceDeploy(service);
	if (dryRun) {
		return {
			service: service.key,
			status: 'planned',
			command: [plan.command, ...plan.args].join(' '),
			cwd: plan.cwd,
			publicBaseUrl: service.publicBaseUrl,
		};
	}

	if (service.buildCommand) {
		const buildResult = spawnSync('bash', ['-lc', service.buildCommand], {
			cwd: service.rootDir,
			stdio: 'inherit',
			env: { ...process.env },
		});
		if (buildResult.status !== 0) {
			throw new Error(`Railway ${service.key} build command failed.`);
		}
	}

	runRailway(plan.args, { cwd: service.rootDir });
	return {
		service: service.key,
		status: 'deployed',
		command: [plan.command, ...plan.args].join(' '),
		cwd: plan.cwd,
		publicBaseUrl: service.publicBaseUrl,
	};
}
