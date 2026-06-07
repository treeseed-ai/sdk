import { relative, resolve } from 'node:path';
import { compileTreeseedHostingGraph, serializeHostingUnit, type TreeseedHostingEnvironment } from '../../hosting/index.ts';
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

export function collectTreeseedDeploymentReadiness(options: TreeseedDeploymentReadinessOptions): TreeseedDeploymentReadinessReport {
	const tenantRoot = resolve(options.tenantRoot);
	const environment = options.environment;
	const graph = compileTreeseedHostingGraph({ tenantRoot, environment });
	const units = graph.units.map((unit) => serializeHostingUnit(unit));
	const railwayServices = configuredRailwayServices(tenantRoot, environment);
	const checks: TreeseedDeploymentReadinessCheck[] = [];
	const isMarketControlPlane = graph.deployConfig.hosting?.kind === 'market_control_plane' || graph.deployConfig.slug === 'treeseed-market';
	const web = unitById(units, 'web');
	const api = unitById(units, 'api');
	const runner = unitById(units, 'marketOperationsRunner');
	const database = unitById(units, 'marketDatabase');
	const railwayApi = railwayServiceByKey(railwayServices, 'api');
	const railwayRunner = railwayServiceByKey(railwayServices, 'marketOperationsRunner');

	if (!isMarketControlPlane) {
		checks.push({
			id: 'hosting:market-control-plane:scope',
			status: 'skipped',
			observed: {
				hostingKind: graph.deployConfig.hosting?.kind ?? null,
				slug: graph.deployConfig.slug ?? null,
			},
			message: 'Market API and operations runner readiness checks only apply to Market control-plane deployments.',
		});
		const counts = summary(checks);
		return {
			environment,
			ok: true,
			generatedAt: (options.now ?? new Date()).toISOString(),
			checks,
			summary: counts,
		};
	}

	if (!web) {
		checks.push({
			id: 'hosting:web:present',
			status: 'failed',
			message: 'Web hosting unit is missing from the effective hosting graph.',
			remediation: 'Restore surfaces.web in treeseed.site.yaml.',
		});
	} else {
		checks.push(check('hosting:web:host', web.hostId, environment === 'local' ? 'local-process' : 'cloudflare', 'Web host matches the expected environment host.', 'Set surfaces.web.provider to cloudflare for hosted environments.', 'hostId'));
		checks.push(check('hosting:web:rootDir', web.config?.rootDir, '.', 'Web rootDir is the top-level UI application.', 'Set surfaces.web.rootDir to ".".', 'rootDir'));
	}

	if (!api) {
		checks.push({
			id: 'hosting:api:present',
			status: 'failed',
			message: 'API hosting unit is missing from the effective hosting graph.',
			remediation: 'Restore services.api in treeseed.site.yaml.',
		});
	} else {
		checks.push(check('hosting:api:host', api.hostId, environment === 'local' ? 'local-process' : 'railway', 'API host matches the expected environment host.', 'Set services.api.provider to railway for hosted environments.', 'hostId'));
		checks.push(check('hosting:api:projectGroup', api.projectGroupId, 'market-control-plane', 'API project group targets the Market control plane.', 'Bind services.api to the market-control-plane project group.', 'projectGroupId'));
		checks.push(check('hosting:api:rootDir', api.config?.rootDir, 'packages/api', 'API effective rootDir points at the API package.', 'Set both services.api.rootDir and services.api.railway.rootDir to packages/api.', 'rootDir'));
		checks.push(check('hosting:api:buildCommand', api.config?.buildCommand, 'npm run build', 'API build command is package-local.', 'Set services.api.railway.buildCommand to "npm run build".', 'buildCommand'));
		checks.push(check('hosting:api:startCommand', api.config?.startCommand, 'npm run start:api', 'API start command is package-local.', 'Set services.api.railway.startCommand to "npm run start:api".', 'startCommand'));
		checks.push(check('hosting:api:healthcheckPath', api.config?.healthcheckPath, '/healthz', 'API healthcheck path is /healthz.', 'Set services.api.railway.healthcheckPath to /healthz.', 'healthcheckPath'));
	}

	if (railwayApi) {
		checks.push(check('railway-config:api:serviceName', railwayApi.serviceName, 'treeseed-market-api', 'Railway API service name is stable.', 'Do not rename the existing Railway API service.', 'serviceName'));
		checks.push(check('railway-config:api:rootDirectory', relRoot(tenantRoot, railwayApi.rootDir), 'packages/api', 'Railway API effective rootDirectory points at packages/api.', 'Set services.api.railway.rootDir to packages/api.', 'rootDirectory'));
	}

	if (!runner) {
		checks.push({
			id: 'hosting:marketOperationsRunner:present',
			status: 'failed',
			message: 'Market operations runner hosting unit is missing from the effective hosting graph.',
			remediation: 'Restore services.marketOperationsRunner in treeseed.site.yaml.',
		});
	} else {
		checks.push(check('hosting:marketOperationsRunner:host', runner.hostId, environment === 'local' ? 'local-docker' : 'railway', 'Runner host matches the expected environment host.', 'Set services.marketOperationsRunner.provider to railway for hosted environments.', 'hostId'));
		checks.push(check('hosting:marketOperationsRunner:projectGroup', runner.projectGroupId, 'market-control-plane', 'Runner project group targets the Market control plane.', 'Bind services.marketOperationsRunner to the market-control-plane project group.', 'projectGroupId'));
		checks.push(check('hosting:marketOperationsRunner:rootDir', runner.config?.rootDir, 'packages/api', 'Runner effective rootDir points at the API package.', 'Set both services.marketOperationsRunner.rootDir and services.marketOperationsRunner.railway.rootDir to packages/api.', 'rootDir'));
		checks.push(check('hosting:marketOperationsRunner:buildCommand', runner.config?.buildCommand, 'npm run build', 'Runner build command is package-local.', 'Set services.marketOperationsRunner.railway.buildCommand to "npm run build".', 'buildCommand'));
		checks.push(check('hosting:marketOperationsRunner:startCommand', runner.config?.startCommand, 'npm run start:runner', 'Runner start command is package-local.', 'Set services.marketOperationsRunner.railway.startCommand to "npm run start:runner".', 'startCommand'));
		checks.push(check('hosting:marketOperationsRunner:healthcheckPath', runner.config?.healthcheckPath, '/healthz', 'Runner healthcheck path is /healthz.', 'Set services.marketOperationsRunner.railway.healthcheckPath to /healthz.', 'healthcheckPath'));
		checks.push(check('hosting:marketOperationsRunner:runtimeMode', runner.config?.runtimeMode, 'service', 'Runner runtime mode is a long-running service.', 'Set services.marketOperationsRunner.railway.runtimeMode to service.', 'runtimeMode'));
		checks.push(check('hosting:marketOperationsRunner:volumeMountPath', runner.config?.volumeMountPath, '/data', 'Runner volume mount path is stable.', 'Set services.marketOperationsRunner.railway.volumeMountPath to /data.', 'volumeMountPath'));
	}

	if (railwayRunner) {
		checks.push(check('railway-config:marketOperationsRunner:serviceName', railwayRunner.serviceName, 'treeseed-market-operations-runner-01', 'Railway runner service instance name is stable.', 'Do not rename the existing Railway runner service instance.', 'serviceName'));
		checks.push(check('railway-config:marketOperationsRunner:rootDirectory', relRoot(tenantRoot, railwayRunner.rootDir), 'packages/api', 'Railway runner effective rootDirectory points at packages/api.', 'Set services.marketOperationsRunner.railway.rootDir to packages/api.', 'rootDirectory'));
	}

	if (!database) {
		checks.push({
			id: 'hosting:marketDatabase:present',
			status: 'failed',
			message: 'Market database hosting unit is missing from the effective hosting graph.',
			remediation: 'Restore services.marketDatabase in treeseed.site.yaml.',
		});
	} else {
		checks.push(checkIncludes('hosting:marketDatabase:serviceTargets', database.config?.serviceTargets, ['api', 'marketOperationsRunner'], 'Market database targets API and runner services.', 'Set services.marketDatabase.railway.serviceTargets to include api and marketOperationsRunner.'));
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
