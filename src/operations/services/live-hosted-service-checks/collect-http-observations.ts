import { resolve } from 'node:path';
import { loadTreeseedPlatformConfig } from '../../../platform/config.ts';
import { resolveTreeseedLaunchEnvironment } from '../config-runtime.ts';
import {
	getRailwayServiceInstance,
	inspectRailwayServiceDeploymentHealth,
	listRailwayEnvironments,
	listRailwayProjects,
	listRailwayServices,
	listRailwayVariables,
	listRailwayVolumes,
	normalizeRailwayEnvironmentName,
	resolveRailwayWorkspaceContext,
} from '../railway-api.ts';
import {
	configuredRailwayServices,
	findStaleTreeseedOperationsRunnerResources,
	isTreeseedOperationsRunnerResourceName,
	railwayObsoleteAliasCleanupPolicy,
} from '../railway-deploy.ts';
import { railwayTreeDxServiceName } from '../railway-source-policy.ts';
import { discoverTreeseedApplications } from '../../../hosting/apps.ts';
import {
	collectTreeseedHostedServiceChecks,
	type TreeseedHostedServiceCheckReport,
	type TreeseedHostedServiceTarget,
	type TreeseedObservedRailwayServiceState,
} from '../hosted-service-checks.ts';
import { TreeseedLiveHostedServiceCheckOptions, TreeseedLiveHostedServiceCheckReport, observeHttp, pagesBranchName, selectedServiceKeySet, selectedWebConfig, serviceIsSelected, serviceMatchesAppSelection, urlForDomain } from './default-retry-attempts.ts';
import { resolveLiveProviderEnv } from './verify-railway-postgres-topology.ts';
import { collectRailwayObservations } from './collect-railway-observations.ts';

export async function collectHttpObservations(options: TreeseedLiveHostedServiceCheckOptions) {
	const deployConfig = loadTreeseedPlatformConfig({ tenantRoot: options.tenantRoot, environment: options.target, env: options.env }).deployConfig;
	const urls = new Set<string>();
	const fallbacks = new Map<string, string>();
	const selectedServiceKeys = selectedServiceKeySet(options);
	const applications = discoverTreeseedApplications(options.tenantRoot);
	const selectedApplication = options.appId
		? applications.find((application) => application.id === options.appId || application.relativeRoot === options.appId)
		: null;
	const webHttpSelected = selectedServiceKeys.size === 0 || selectedServiceKeys.has('web');
	if (webHttpSelected && (!options.appId || options.appId === 'web' || selectedApplication?.roles.includes('web'))) {
		const webConfig = selectedWebConfig(deployConfig, selectedApplication);
		const webDomain = webConfig.surfaces?.web?.environments?.[options.target]?.domain
			?? webConfig.surfaces?.web?.publicBaseUrl
			?? webConfig.siteUrl;
		const webUrl = urlForDomain(webDomain);
		if (webUrl) {
			urls.add(webUrl);
			if (selectedServiceKeys.size === 0 && (!options.appId || options.appId === 'web' || selectedApplication?.roles.includes('api'))) {
				urls.add(`${webUrl}/v1/healthz`);
			}
			const pagesProjectName = webConfig.cloudflare?.pages?.projectName;
			if (pagesProjectName) {
				const branchName = pagesBranchName(webConfig, options.target);
				const pagesUrl = options.target === 'prod'
					? `https://${pagesProjectName}.pages.dev`
					: `https://${branchName}.${pagesProjectName}.pages.dev`;
				fallbacks.set(webUrl, pagesUrl);
			}
		}
	}
	for (const service of configuredRailwayServices(options.tenantRoot, options.target, options.env)
		.filter((entry) => serviceMatchesAppSelection(entry, options.tenantRoot, options.appId, applications))
		.filter((entry) => serviceIsSelected(selectedServiceKeys, entry.key))) {
		const serviceConfig = deployConfig.services?.[service.key];
		const domain = service.publicBaseUrl
			?? serviceConfig?.environments?.[options.target]?.baseUrl
			?? serviceConfig?.environments?.[options.target]?.domain
			?? (service.key === 'api' ? deployConfig.surfaces?.api?.environments?.[options.target]?.domain : null);
		const baseUrl = urlForDomain(domain);
		if (!baseUrl) continue;
		urls.add(`${baseUrl}${service.healthcheckPath ?? '/healthz'}`);
		if (service.key === 'api') urls.add(`${baseUrl}/healthz/deep`);
	}
	const entries = await Promise.all([...urls].map(async (url) => {
		const observed = await observeHttp(url, options);
		const fallbackUrl = fallbacks.get(url);
		if ((observed.ok !== true && !observed.status) && fallbackUrl) {
			const fallback = await observeHttp(fallbackUrl, options);
			return [url, {
				...observed,
				fallbackUrl,
				fallbackStatus: fallback.status,
				fallbackOk: fallback.ok,
				fallbackError: fallback.error,
			}] as const;
		}
		return [url, observed] as const;
	}));
	return Object.fromEntries(entries);
}

export function strictenReport(report: TreeseedLiveHostedServiceCheckReport, options: TreeseedLiveHostedServiceCheckOptions) {
	if (!options.strict) return report;
	const checks = report.checks.map((check) => {
		if (check.status !== 'skipped') return check;
		const providerRequired = (options.requireLiveRailway && check.provider === 'railway')
			|| (options.requireLiveHttp && check.provider === 'http');
		if (!providerRequired) return check;
		return {
			...check,
			status: 'failed' as const,
			issues: check.issues.length > 0 ? check.issues : ['Required live observation was not available.'],
			remediation: check.remediation ?? 'Run provider configuration bootstrap or verify provider credentials, then rerun with --live.',
		};
	});
	const summary = {
		passed: checks.filter((entry) => entry.status === 'passed').length,
		failed: checks.filter((entry) => entry.status === 'failed').length,
		skipped: checks.filter((entry) => entry.status === 'skipped').length,
		warning: checks.filter((entry) => entry.status === 'warning').length,
	};
	return { ...report, checks, summary };
}

export async function collectTreeseedLiveHostedServiceChecks(options: TreeseedLiveHostedServiceCheckOptions): Promise<TreeseedLiveHostedServiceCheckReport> {
	const effectiveOptions = {
		...options,
		env: resolveLiveProviderEnv(options),
	};
	const requireLiveRailway = options.requireLiveRailway ?? options.strict === true;
	const requireLiveHttp = options.requireLiveHttp ?? options.strict === true;
	const railway = requireLiveRailway
		? await collectRailwayObservations(effectiveOptions)
		: { observed: {}, status: 'skipped' as const, issues: [] };
	const httpChecks = requireLiveHttp
		? await collectHttpObservations(effectiveOptions)
		: {};
	const report = collectTreeseedHostedServiceChecks({
		tenantRoot: effectiveOptions.tenantRoot,
		target: effectiveOptions.target,
		appId: effectiveOptions.appId,
		serviceKeys: effectiveOptions.serviceKeys,
		env: effectiveOptions.env,
		observedRailwayServices: railway.observed,
		httpChecks,
	});
	const railwayIssues = railway.issues.map((issue) => issue.trim()).filter(Boolean);
	const providerIssueChecks = railwayIssues.map((issue, index) => ({
		id: `railway:live-issue:${index + 1}`,
		provider: 'railway' as const,
		serviceType: 'unknown' as const,
		target: options.target,
		description: 'Railway live provider verification issue.',
		expected: { ok: true },
		observed: { issue },
		status: 'failed' as const,
		issues: [issue],
	}));
	const reportWithLiveIssues = providerIssueChecks.length > 0
		? {
			...report,
			checks: [...report.checks, ...providerIssueChecks],
			summary: {
				passed: report.checks.filter((entry) => entry.status === 'passed').length,
				failed: report.checks.filter((entry) => entry.status === 'failed').length + providerIssueChecks.length,
				skipped: report.checks.filter((entry) => entry.status === 'skipped').length,
				warning: report.checks.filter((entry) => entry.status === 'warning').length,
			},
		}
		: report;
	const httpStatus = requireLiveHttp
		? Object.values(httpChecks).some((entry) => entry.ok === true || entry.status)
			? 'observed'
			: 'failed'
		: 'skipped';
	return strictenReport({
		...reportWithLiveIssues,
		live: true,
		liveObservation: {
			railway: railway.status,
			http: httpStatus,
			issues: railwayIssues,
		},
	}, options);
}
