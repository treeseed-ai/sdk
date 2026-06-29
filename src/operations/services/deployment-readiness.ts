import { relative, resolve } from 'node:path';
import { compileTreeseedHostingGraph, serializeHostingUnit, type TreeseedHostingEnvironment } from '../../hosting/index.ts';
import { discoverTreeseedPackageAdapters, type TreeseedPackageAdapter } from './package-adapters.ts';
import { configuredRailwayServices } from './railway-deploy.ts';

export type TreeseedDeploymentReadinessStatus = 'passed' | 'failed' | 'warning' | 'skipped';

export interface TreeseedDeploymentReadinessCheck {
	id: string;
	status: TreeseedDeploymentReadinessStatus;
	expected?: Record<string, unknown>;
	observed?: Record<string, unknown>;
	message: string;
	remediation?: string;
}

export interface TreeseedDeploymentReadinessReport {
	environment: TreeseedHostingEnvironment;
	ok: boolean;
	generatedAt: string;
	checks: TreeseedDeploymentReadinessCheck[];
	summary: {
		passed: number;
		failed: number;
		warning: number;
		skipped: number;
	};
}

export interface TreeseedDeploymentReadinessOptions {
	tenantRoot: string;
	environment: TreeseedHostingEnvironment;
	appId?: string;
	now?: Date;
}

function relRoot(tenantRoot: string, path: string) {
	const value = relative(tenantRoot, path).split('\\').join('/');
	return value || '.';
}

function summary(checks: TreeseedDeploymentReadinessCheck[]) {
	return {
		passed: checks.filter((check) => check.status === 'passed').length,
		failed: checks.filter((check) => check.status === 'failed').length,
		warning: checks.filter((check) => check.status === 'warning').length,
		skipped: checks.filter((check) => check.status === 'skipped').length,
	};
}

function check(
	id: string,
	actual: unknown,
	expected: unknown,
	message: string,
	remediation: string,
	key = id.split(':').at(-1) ?? 'value',
): TreeseedDeploymentReadinessCheck {
	const passed = actual === expected;
	return {
		id,
		status: passed ? 'passed' : 'failed',
		expected: { [key]: expected },
		observed: { [key]: actual ?? null },
		message: passed ? message : `${message} Expected ${String(expected)}, observed ${String(actual ?? '(unset)')}.`,
		remediation: passed ? undefined : remediation,
	};
}

function checkIncludes(id: string, values: unknown, required: string[], message: string, remediation: string): TreeseedDeploymentReadinessCheck {
	const observed = Array.isArray(values) ? values.map(String) : [];
	const missing = required.filter((value) => !observed.includes(value));
	return {
		id,
		status: missing.length === 0 ? 'passed' : 'failed',
		expected: { includes: required },
		observed: { values: observed },
		message: missing.length === 0 ? message : `${message} Missing: ${missing.join(', ')}.`,
		remediation: missing.length === 0 ? undefined : remediation,
	};
}

function unitById(units: Array<ReturnType<typeof serializeHostingUnit>>, id: string) {
	return units.find((unit) => unit.id === id) ?? null;
}

function railwayServiceByKey(services: any[], key: string) {
	return services.find((service) => service.key === key) ?? null;
}

function recordValue(value: unknown) {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasLocalDevService(adapter: TreeseedPackageAdapter, serviceId: string) {
	const localDev = recordValue(adapter.metadata.localDev);
	const services = recordValue(localDev.services);
	return Object.keys(recordValue(services[serviceId])).length > 0;
}

function discoveredApiPackageRoot(tenantRoot: string) {
	const adapters = discoverTreeseedPackageAdapters(tenantRoot);
	const matches = adapters.filter((adapter) => hasLocalDevService(adapter, 'api') || hasLocalDevService(adapter, 'operationsRunner'));
	return matches.find((adapter) => adapter.id === '@treeseed/api')?.relativeDir
		?? matches.find((adapter) => hasLocalDevService(adapter, 'api'))?.relativeDir
		?? matches[0]?.relativeDir
		?? null;
}

export function collectTreeseedDeploymentReadiness(options: TreeseedDeploymentReadinessOptions): TreeseedDeploymentReadinessReport {
	const tenantRoot = resolve(options.tenantRoot);
	const environment = options.environment;
	const graph = compileTreeseedHostingGraph({ tenantRoot, environment, appId: options.appId });
	const units = graph.units.map((unit) => serializeHostingUnit(unit));
	const railwayServices = configuredRailwayServices(tenantRoot, environment)
		.filter((service) => !options.appId || service.application?.id === options.appId);
	const checks: TreeseedDeploymentReadinessCheck[] = [];
	const web = unitById(units, 'web');
	const api = unitById(units, 'api');
	const runner = unitById(units, 'operationsRunner');
	const database = unitById(units, 'treeseedDatabase');
	const hasApiPlane = Boolean(api || runner || database);
	const hasWorkspaceMarketControlPlane = graph.applications?.some((app) => app.config.hosting?.kind === 'treeseed_control_plane') === true
		|| graph.deployConfig.hosting?.kind === 'treeseed_control_plane';
	const railwayApi = railwayServiceByKey(railwayServices, 'api');
	const railwayRunner = railwayServiceByKey(railwayServices, 'operationsRunner');

	if (!web) {
		if (!hasApiPlane) {
			checks.push({
				id: 'hosting:web:present',
				status: 'failed',
				message: 'Web hosting unit is missing from the effective hosting graph.',
				remediation: 'Restore surfaces.web in treeseed.site.yaml.',
			});
		}
	} else {
		checks.push(check('hosting:web:host', web.hostId, environment === 'local' ? 'local-process' : 'cloudflare', 'Web host matches the expected environment host.', 'Set surfaces.web.provider to cloudflare for hosted environments.', 'hostId'));
		checks.push(check('hosting:web:rootDir', web.config?.rootDir, '.', 'Web rootDir is the top-level UI application.', 'Set surfaces.web.rootDir to ".".', 'rootDir'));
		const apiConnection = graph.deployConfig.connections?.api;
		const configuredBaseUrl = environment === 'local'
			? apiConnection?.localBaseUrl
			: apiConnection?.environments?.[environment]?.baseUrl ?? apiConnection?.environments?.[environment]?.domain;
		checks.push({
			id: 'connection:api',
			status: hasApiPlane || configuredBaseUrl ? 'passed' : 'failed',
			expected: { apiConnection: true },
			observed: {
				localApiAppPresent: hasApiPlane,
				baseUrl: configuredBaseUrl ?? null,
				proxyPrefix: apiConnection?.proxyPrefix ?? null,
			},
			message: hasApiPlane || configuredBaseUrl
				? 'Web app has an API app or configured API connection.'
				: 'Web app requires an API connection when no local API app manifest is present.',
			remediation: hasApiPlane || configuredBaseUrl ? undefined : 'Add connections.api to treeseed.site.yaml or include an API package with treeseed.package.yaml localDev metadata.',
		});
	}

	if (!hasApiPlane && !hasWorkspaceMarketControlPlane) {
		const counts = summary(checks);
		return {
			environment,
			ok: counts.failed === 0,
			generatedAt: (options.now ?? new Date()).toISOString(),
			checks,
			summary: counts,
		};
	}

	const apiIsNestedApp = Boolean(api?.application?.relativeRoot && api.application.relativeRoot !== '.');
	const runnerIsNestedApp = Boolean(runner?.application?.relativeRoot && runner.application.relativeRoot !== '.');
	const apiPackageRoot = discoveredApiPackageRoot(tenantRoot) ?? 'packages/api';
	const expectedApiUnitRoot = apiIsNestedApp ? '.' : apiPackageRoot;
	const expectedRunnerUnitRoot = runnerIsNestedApp ? '.' : apiPackageRoot;
	const expectedApiRailwayRoot = api?.application?.relativeRoot && api.application.relativeRoot !== '.'
		? api.application.relativeRoot
		: expectedApiUnitRoot;
	const expectedRunnerRailwayRoot = runner?.application?.relativeRoot && runner.application.relativeRoot !== '.'
		? runner.application.relativeRoot
		: expectedRunnerUnitRoot;

	if (!api) {
		checks.push({
			id: 'hosting:api:present',
			status: 'failed',
			message: 'API hosting unit is missing from the effective hosting graph.',
			remediation: 'Restore services.api in treeseed.site.yaml.',
		});
	} else {
		checks.push(check('hosting:api:host', api.hostId, environment === 'local' ? 'local-process' : 'railway', 'API host matches the expected environment host.', 'Set services.api.provider to railway for hosted environments.', 'hostId'));
		checks.push(check('hosting:api:projectGroup', api.projectGroupId, 'treeseed-control-plane', 'API project group targets the Treeseed control plane.', 'Bind services.api to the treeseed-control-plane project group.', 'projectGroupId'));
		checks.push(check('hosting:api:rootDir', api.config?.rootDir, expectedApiUnitRoot, 'API effective rootDir points at the API package.', 'Set services.api.rootDir and services.api.railway.rootDir relative to the owning API manifest.', 'rootDir'));
		if (environment === 'local') {
			checks.push(check('hosting:api:buildCommand', api.config?.buildCommand, 'npm run build', 'API build command is package-local.', 'Set services.api.railway.buildCommand to "npm run build".', 'buildCommand'));
			checks.push(check('hosting:api:startCommand', api.config?.startCommand, 'npm run start:api', 'API start command is package-local.', 'Set services.api.railway.startCommand to "npm run start:api".', 'startCommand'));
		} else if (environment === 'staging') {
			checks.push(check('hosting:api:sourceMode', api.config?.sourceMode, 'git', 'API staging deploy uses Railway Git source builds.', 'Set services.api.railway.sourceMode to git.', 'sourceMode'));
			checks.push(check('hosting:api:sourceRepo', Boolean(api.config?.sourceRepo), true, 'API staging source repository is resolved.', 'Set services.api.railway.sourceRepo or package repository metadata.', 'sourceRepo'));
		} else {
			checks.push(check('hosting:api:imageRefEnv', api.config?.imageRefEnv, 'TREESEED_API_IMAGE_REF', 'API Railway deploy uses a Docker image reference.', 'Set services.api.railway.imageRef or inject TREESEED_API_IMAGE_REF.', 'imageRefEnv'));
		}
		checks.push(check('hosting:api:healthcheckPath', api.config?.healthcheckPath, '/healthz', 'API healthcheck path is /healthz.', 'Set services.api.railway.healthcheckPath to /healthz.', 'healthcheckPath'));
	}

	if (railwayApi) {
		checks.push(check('railway-config:api:serviceName', railwayApi.serviceName, 'treeseed-api', 'Railway API service uses the canonical name.', 'Set services.api.railway.serviceName to treeseed-api.', 'serviceName'));
		checks.push(check('railway-config:api:rootDirectory', relRoot(tenantRoot, railwayApi.rootDir), expectedApiRailwayRoot, 'Railway API effective rootDirectory points at the API app.', 'Set services.api.railway.rootDir relative to the owning API manifest.', 'rootDirectory'));
	}

	if (!runner) {
		checks.push({
			id: 'hosting:operationsRunner:present',
			status: 'failed',
			message: 'Treeseed operations runner hosting unit is missing from the effective hosting graph.',
			remediation: 'Restore services.operationsRunner in treeseed.site.yaml.',
		});
	} else {
		checks.push(check('hosting:operationsRunner:host', runner.hostId, environment === 'local' ? 'local-docker' : 'railway', 'Runner host matches the expected environment host.', 'Set services.operationsRunner.provider to railway for hosted environments.', 'hostId'));
		checks.push(check('hosting:operationsRunner:projectGroup', runner.projectGroupId, 'treeseed-control-plane', 'Runner project group targets the Treeseed control plane.', 'Bind services.operationsRunner to the treeseed-control-plane project group.', 'projectGroupId'));
		checks.push(check('hosting:operationsRunner:rootDir', runner.config?.rootDir, expectedRunnerUnitRoot, 'Runner effective rootDir points at the API package.', 'Set services.operationsRunner.rootDir and services.operationsRunner.railway.rootDir relative to the owning API manifest.', 'rootDir'));
		if (environment === 'local') {
			checks.push(check('hosting:operationsRunner:buildCommand', runner.config?.buildCommand, 'npm run build', 'Runner build command is package-local.', 'Set services.operationsRunner.railway.buildCommand to "npm run build".', 'buildCommand'));
			checks.push(check('hosting:operationsRunner:startCommand', runner.config?.startCommand, 'npm run start:runner', 'Runner start command is package-local.', 'Set services.operationsRunner.railway.startCommand to "npm run start:runner".', 'startCommand'));
		} else if (environment === 'staging') {
			checks.push(check('hosting:operationsRunner:sourceMode', runner.config?.sourceMode, 'git', 'Runner staging deploy uses Railway Git source builds.', 'Set services.operationsRunner.railway.sourceMode to git.', 'sourceMode'));
			checks.push(check('hosting:operationsRunner:sourceRepo', Boolean(runner.config?.sourceRepo), true, 'Runner staging source repository is resolved.', 'Set services.operationsRunner.railway.sourceRepo or package repository metadata.', 'sourceRepo'));
		} else {
			checks.push(check('hosting:operationsRunner:imageRefEnv', runner.config?.imageRefEnv, 'TREESEED_OPERATIONS_RUNNER_IMAGE_REF', 'Runner Railway deploy uses a Docker image reference.', 'Set services.operationsRunner.railway.imageRef or inject TREESEED_OPERATIONS_RUNNER_IMAGE_REF.', 'imageRefEnv'));
		}
		checks.push(check('hosting:operationsRunner:healthcheckPath', runner.config?.healthcheckPath, '/healthz', 'Runner healthcheck path is /healthz.', 'Set services.operationsRunner.railway.healthcheckPath to /healthz.', 'healthcheckPath'));
		checks.push(check('hosting:operationsRunner:runtimeMode', runner.config?.runtimeMode, 'service', 'Runner runtime mode is a long-running service.', 'Set services.operationsRunner.railway.runtimeMode to service.', 'runtimeMode'));
		checks.push(check('hosting:operationsRunner:volumeMountPath', runner.config?.volumeMountPath, '/data', 'Runner volume mount path is stable.', 'Set services.operationsRunner.railway.volumeMountPath to /data.', 'volumeMountPath'));
	}

	if (railwayRunner) {
		checks.push(check('railway-config:operationsRunner:serviceName', railwayRunner.serviceName, 'treeseed-api-operations-runner-01', 'Railway runner service instance uses the canonical name.', 'Set the runner service instance name to treeseed-api-operations-runner-01.', 'serviceName'));
		checks.push(check('railway-config:operationsRunner:rootDirectory', relRoot(tenantRoot, railwayRunner.rootDir), expectedRunnerRailwayRoot, 'Railway runner effective rootDirectory points at the API app.', 'Set services.operationsRunner.railway.rootDir relative to the owning API manifest.', 'rootDirectory'));
	}

	if (!database) {
		checks.push({
			id: 'hosting:treeseedDatabase:present',
			status: 'failed',
			message: 'Treeseed database hosting unit is missing from the effective hosting graph.',
			remediation: 'Restore services.treeseedDatabase in treeseed.site.yaml.',
		});
	} else {
		checks.push(checkIncludes('hosting:treeseedDatabase:serviceTargets', database.config?.serviceTargets, ['api', 'operationsRunner'], 'Treeseed database targets API and runner services.', 'Set services.treeseedDatabase.railway.serviceTargets to include api and operationsRunner.'));
	}

	const counts = summary(checks);
	return {
		environment,
		ok: counts.failed === 0,
		generatedAt: (options.now ?? new Date()).toISOString(),
		checks,
		summary: counts,
	};
}

export function formatTreeseedReadinessReport(report: TreeseedDeploymentReadinessReport) {
	const lines = [
		`Deployment readiness for ${report.environment}: ${report.ok ? 'passed' : 'failed'}`,
		`passed=${report.summary.passed} failed=${report.summary.failed} warning=${report.summary.warning} skipped=${report.summary.skipped}`,
	];
	for (const check of report.checks.filter((entry) => entry.status !== 'passed')) {
		lines.push(`${check.status.toUpperCase()} ${check.id}: ${check.message}${check.remediation ? ` Remediation: ${check.remediation}` : ''}`);
	}
	return lines.join('\n');
}
