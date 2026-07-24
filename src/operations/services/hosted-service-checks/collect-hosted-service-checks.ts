import { relative, resolve } from 'node:path';
import { collectEnvironmentContext, resolveMachineEnvironmentValues } from '../configuration/config-runtime.ts';
import { configuredRailwayServices } from '../hosting/railway/railway-deploy.ts';
import { isApiRailwaySourcePolicyService, isImmutableRailwayImageRef } from '../hosting/railway/railway-source-policy.ts';
import { loadPlatformConfig } from '../../../platform/configuration/config.ts';
import { discoverApplications } from '../../../hosting/apps.ts';
import { RAILWAY_SECRET_KEYS_BY_SERVICE, RAILWAY_VARIABLE_KEYS_BY_SERVICE, HostedServiceCheck, HostedServiceCheckOptions, HostedServiceCheckReport, ObservedRailwayServiceState, check, httpStatus, observedFor, railwayServiceRootDirectory, railwayServiceUsesImageSource, rootDirectory, serviceTypeFor, statusForMatch, valuePresence, webCheckConfig } from './hosted-service-check-status.ts';

export function collectHostedServiceChecks(options: HostedServiceCheckOptions): HostedServiceCheckReport {
	const target = options.target ?? 'prod';
	const tenantRoot = options.tenantRoot;
	const configEnv = { ...process.env, ...(options.env ?? {}) };
	const deployConfig = loadPlatformConfig({ tenantRoot, environment: target, env: configEnv }).deployConfig;
	const registry = collectEnvironmentContext(tenantRoot);
	let machineValues: Record<string, string | undefined> = {};
	try {
		machineValues = resolveMachineEnvironmentValues(tenantRoot, target);
	} catch {
		machineValues = {};
	}
	const values = { ...machineValues, ...configEnv, ...(options.valuesOverlay ?? {}) };
	const checks: HostedServiceCheck[] = [];
	const selectedServiceKeys = new Set((options.serviceKeys ?? []).map((key) => key.trim()).filter(Boolean));
	const selectedAppId = options.appId?.trim() || null;
	const applications = discoverApplications(tenantRoot);
	const selectedApplication = selectedAppId
		? applications.find((application) => application.id === selectedAppId || application.relativeRoot === selectedAppId)
		: null;
	const selectedService = (serviceKey: string) => selectedServiceKeys.size === 0 || selectedServiceKeys.has(serviceKey);
	const workspaceHasApiApplication = applications.some((application) =>
		application.roles.includes('api')
		|| application.config.surfaces?.api?.enabled === true
		|| application.config.services?.api?.enabled !== false && Boolean(application.config.services?.api)
	);
	const includeWeb = selectedService('web') && (!selectedAppId || selectedAppId === 'web' || selectedApplication?.roles.includes('web') === true);
	const includeApi = selectedService('api') && (!selectedAppId || selectedAppId === 'api' || selectedApplication?.roles.includes('api') === true);
	const selectedAppHasApi = Boolean(
		selectedApplication?.roles.includes('api')
		|| selectedApplication?.config.surfaces?.api?.enabled === true
		|| selectedApplication?.config.services?.api?.enabled !== false && selectedApplication?.config.services?.api
		|| selectedAppId === 'web' && workspaceHasApiApplication
		|| selectedAppId === 'web' && (
			deployConfig.surfaces?.api?.enabled === true
			|| deployConfig.services?.api?.enabled !== false && deployConfig.services?.api
		),
	);

	const selectedWeb = webCheckConfig(deployConfig, selectedApplication);
	const web = selectedWeb.web;
	if (includeWeb && web?.enabled !== false && web?.provider === 'cloudflare') {
		const domain = web.environments?.[target]?.domain ?? web.publicBaseUrl ?? selectedWeb.config.siteUrl ?? null;
		checks.push(check({
			id: `cloudflare:${selectedWeb.appId}:surface`,
			provider: 'cloudflare',
			serviceKey: selectedWeb.appId,
			serviceType: 'web',
			target,
			description: 'Cloudflare web surface is configured.',
			expected: {
				provider: 'cloudflare',
				domain,
				pagesProjectName: selectedWeb.config.cloudflare?.pages?.projectName ?? null,
			},
			observed: { configured: true },
			status: 'passed',
		}));
		if (domain) {
			const url = String(domain).startsWith('http') ? String(domain) : `https://${domain}`;
			checks.push({ ...httpStatus(url, options), id: `http:${selectedWeb.appId}`, serviceKey: selectedWeb.appId, serviceType: 'web', description: 'Web public URL responds.' });
			if (selectedServiceKeys.size === 0 && (!selectedAppId || selectedAppHasApi)) {
				checks.push({ ...httpStatus(`${url.replace(/\/+$/u, '')}/v1/healthz`, options), id: `http:${selectedWeb.appId}:v1-healthz`, serviceKey: selectedWeb.appId, serviceType: 'web', description: 'Web proxy reaches API health.' });
			}
		}
	}
	for (const [surfaceKey, surface] of Object.entries(deployConfig.surfaces ?? {})) {
		if (!selectedService(surfaceKey)) continue;
		if (selectedAppId === 'api' && surfaceKey === 'web') continue;
		if (surface && typeof surface === 'object' && surface.enabled !== false && surface.provider && !['cloudflare', 'railway'].includes(surface.provider)) {
			checks.push(check({
				id: `surface-provider:${surfaceKey}:${surface.provider}`,
				provider: surface.provider === 'github' ? 'github' : 'http',
				serviceKey: surfaceKey,
				serviceType: surfaceKey === 'web' ? 'web' : surfaceKey === 'api' ? 'api' : 'unknown',
				target,
				description: `Unsupported hosted surface provider ${surface.provider}.`,
				expected: { supportedProviders: ['cloudflare', 'railway'] },
				observed: { provider: surface.provider },
				status: 'warning',
				issues: [`Hosted service checker does not yet support provider ${surface.provider}.`],
			}));
		}
	}

	const configuredServices = configuredRailwayServices(tenantRoot, target, configEnv)
		.filter((service) => !selectedAppId || service.application?.id === selectedAppId)
		.filter((service) => selectedServiceKeys.size === 0 || selectedServiceKeys.has(service.key));
	for (const service of configuredServices) {
		const serviceType = serviceTypeFor(service.key);
		const observed = observedFor(options, service.serviceName);
		const expectedRootDirectory = railwayServiceRootDirectory(tenantRoot, service);
		const apiSourcePolicyService = isApiRailwaySourcePolicyService(service);
		if (target === 'prod' && apiSourcePolicyService && railwayServiceUsesImageSource(service)) {
			checks.push(check({
				id: `railway:${service.instanceKey}:image-ref-policy`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} uses an immutable production image reference.`,
				expected: { imageRef: '<released-image>:<immutable-tag>' },
				observed: { imageRef: service.imageRef ?? null },
				status: isImmutableRailwayImageRef(service.imageRef) ? 'passed' : 'failed',
				issues: isImmutableRailwayImageRef(service.imageRef) ? [] : [`Production API Railway service ${service.serviceName} is missing an immutable image ref.`],
			}));
			const observedGitSource = Boolean(observed?.deploymentRepo || observed?.deploymentBranch);
			checks.push(check({
				id: `railway:${service.instanceKey}:production-source-isolation`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} production deployment has no Git source.`,
				expected: { repo: null, branch: null },
				observed: observed ? { repo: observed.deploymentRepo ?? null, branch: observed.deploymentBranch ?? null } : { skipped: true },
				status: observed ? (observedGitSource ? 'failed' : 'passed') : 'skipped',
				issues: observed && observedGitSource ? [`Production API Railway service ${service.serviceName} still reports Git source metadata.`] : [],
			}));
		}
		checks.push(check({
			id: `railway:${service.instanceKey}:service`,
			provider: 'railway',
			serviceKey: service.key,
			serviceType,
			target,
			description: `Railway service ${service.serviceName} is configured.`,
			expected: { projectName: service.projectName, serviceName: service.serviceName, environmentName: service.railwayEnvironment },
			observed: observed
				? { projectName: observed.projectName ?? null, serviceName: observed.serviceName ?? null, environmentName: observed.environmentName ?? null }
				: { skipped: true },
			status: observed ? 'passed' : 'skipped',
			issues: observed ? [] : ['No live Railway observation was provided.'],
		}));

		for (const [key, expected] of Object.entries({
			rootDirectory: railwayServiceUsesImageSource(service) ? null : expectedRootDirectory,
			buildCommand: service.buildCommand,
			dockerfilePath: service.dockerfilePath,
			startCommand: service.startCommand,
			healthcheckPath: service.healthcheckPath,
			healthcheckTimeoutSeconds: service.healthcheckTimeoutSeconds,
			runtimeMode: service.runtimeMode,
		})) {
			if (expected == null) continue;
			const actual = observed?.[key as keyof ObservedRailwayServiceState] ?? null;
			checks.push(check({
				id: `railway:${service.instanceKey}:${key}`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} ${key} matches config.`,
				expected: { [key]: expected },
				observed: observed ? { [key]: actual } : { skipped: true },
				status: observed ? statusForMatch(actual, expected) : 'skipped',
				issues: !observed || actual === expected ? [] : [`Expected ${key}=${expected}, observed ${actual ?? '(unset)'}.`],
			}));
		}

		if (!railwayServiceUsesImageSource(service) && service.sourceRepo) {
			const actualRepo = observed?.deploymentRepo ?? null;
			const actualBranch = observed?.deploymentBranch ?? null;
			const actualRootDirectory = observed?.deploymentRootDirectory ?? null;
			const sourceUploadDeployment = target === 'staging'
				&& !apiSourcePolicyService
				&& actualRepo === null
				&& actualBranch === null
				&& observed?.deploymentHealthy === true;
			checks.push(check({
				id: `railway:${service.instanceKey}:deployment-repo`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} latest deployment uses the desired Git repo.`,
				expected: { repo: service.sourceRepo },
				observed: observed ? { repo: actualRepo, sourceUpload: sourceUploadDeployment } : { skipped: true },
				status: observed ? (sourceUploadDeployment ? 'passed' : statusForMatch(actualRepo, service.sourceRepo)) : 'skipped',
				issues: !observed || sourceUploadDeployment || actualRepo === service.sourceRepo ? [] : [`Expected deployment repo=${service.sourceRepo}, observed ${actualRepo ?? '(unset)'}.`],
			}));
			if (service.sourceBranch) {
				checks.push(check({
					id: `railway:${service.instanceKey}:deployment-branch`,
					provider: 'railway',
					serviceKey: service.key,
					serviceType,
					target,
					description: `Railway ${service.serviceName} latest deployment uses the desired Git branch.`,
					expected: { branch: service.sourceBranch },
					observed: observed ? { branch: actualBranch, commitHash: observed.deploymentCommitHash ?? null, sourceUpload: sourceUploadDeployment } : { skipped: true },
					status: observed ? (sourceUploadDeployment ? 'passed' : statusForMatch(actualBranch, service.sourceBranch)) : 'skipped',
					issues: !observed || sourceUploadDeployment || actualBranch === service.sourceBranch ? [] : [`Expected deployment branch=${service.sourceBranch}, observed ${actualBranch ?? '(unset)'}.`],
				}));
			}
			if (service.sourceCommit) {
				const actualCommit = observed?.deploymentCommitHash ?? null;
				checks.push(check({
					id: `railway:${service.instanceKey}:deployment-commit`,
					provider: 'railway',
					serviceKey: service.key,
					serviceType,
					target,
					description: `Railway ${service.serviceName} latest deployment uses the exact promoted commit.`,
					expected: { commitHash: service.sourceCommit },
					observed: observed ? { commitHash: actualCommit } : { skipped: true },
					status: observed ? statusForMatch(actualCommit, service.sourceCommit) : 'skipped',
					issues: !observed || actualCommit === service.sourceCommit ? [] : [`Expected deployment commitHash=${service.sourceCommit}, observed ${actualCommit ?? '(unset)'}.`],
				}));
			}
			if (expectedRootDirectory) {
				checks.push(check({
					id: `railway:${service.instanceKey}:deployment-root-directory`,
					provider: 'railway',
					serviceKey: service.key,
					serviceType,
					target,
					description: `Railway ${service.serviceName} latest deployment uses the desired Git root directory.`,
					expected: { rootDirectory: expectedRootDirectory },
					observed: observed ? { rootDirectory: actualRootDirectory } : { skipped: true },
					status: observed ? statusForMatch(actualRootDirectory, expectedRootDirectory) : 'skipped',
					issues: !observed || actualRootDirectory === expectedRootDirectory ? [] : [`Expected deployment rootDirectory=${expectedRootDirectory}, observed ${actualRootDirectory ?? '(unset)'}.`],
				}));
			}
		}

		if (observed && observed.deploymentHealthy === false) {
			checks.push(check({
				id: `railway:${service.instanceKey}:deployment`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} latest deployment is healthy.`,
				expected: { healthy: true },
				observed: { healthy: false, status: observed.deploymentStatus ?? null },
				status: 'failed',
				issues: [`Latest Railway deployment status is ${observed.deploymentStatus ?? 'unknown'}.`],
			}));
		} else if (observed) {
			checks.push(check({
				id: `railway:${service.instanceKey}:deployment`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} latest deployment is healthy.`,
				expected: { healthy: true },
				observed: { healthy: observed.deploymentHealthy ?? null, status: observed.deploymentStatus ?? null },
				status: observed.deploymentHealthy === true ? 'passed' : 'skipped',
				issues: observed.deploymentHealthy === true ? [] : ['No live Railway deployment health observation was provided.'],
			}));
		}

		if (service.volumeMountPath) {
			const volumeAttached = Boolean(observed?.volumeId)
				&& observed?.volumeMountPath === service.volumeMountPath
				&& (!observed?.serviceName || !observed?.volumeServiceId || observed.volumeServiceId === observed.serviceId)
				&& observed?.volumePendingDeletion !== true
				&& !(typeof observed?.volumeDeletedAt === 'string' && observed.volumeDeletedAt.trim())
				&& !['DELETING', 'DELETED'].includes(String(observed?.volumeState ?? '').toUpperCase());
			checks.push(check({
				id: `railway:${service.instanceKey}:volume`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} volume mount matches config.`,
				expected: { volumeMountPath: service.volumeMountPath },
				observed: observed ? {
					volumeName: observed.volumeName ?? null,
					volumeId: observed.volumeId ?? null,
					volumeMountPath: observed.volumeMountPath ?? null,
					volumeServiceId: observed.volumeServiceId ?? null,
					volumeEnvironmentId: observed.volumeEnvironmentId ?? null,
					volumeState: observed.volumeState ?? null,
					volumePendingDeletion: observed.volumePendingDeletion ?? null,
					volumeDeletedAt: observed.volumeDeletedAt ?? null,
				} : { skipped: true },
				status: observed ? (volumeAttached ? 'passed' : 'failed') : 'skipped',
				issues: !observed || volumeAttached ? [] : [`Expected an attached persistent volume mounted at ${service.volumeMountPath}, observed ${observed.volumeMountPath ?? '(unset)'} on volume ${observed.volumeName ?? '(none)'}.`],
			}));
			const volumeNotPendingDeletion = observed?.volumePendingDeletion === false
				&& !['DELETING', 'DELETED'].includes(String(observed?.volumeState ?? '').toUpperCase());
			checks.push(check({
				id: `railway:${service.instanceKey}:volume-retained`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} volume is retained and active.`,
				expected: { pendingDeletion: false },
				observed: observed ? {
					volumeName: observed.volumeName ?? null,
					volumeId: observed.volumeId ?? null,
					state: observed.volumeState ?? null,
					pendingDeletion: observed.volumePendingDeletion ?? null,
					deletedAt: observed.volumeDeletedAt ?? null,
				} : { skipped: true },
				status: observed ? (volumeNotPendingDeletion ? 'passed' : 'failed') : 'skipped',
				issues: !observed || volumeNotPendingDeletion ? [] : [`Expected an active retained volume, observed state=${observed.volumeState ?? '(unset)'} pendingDeletion=${String(observed.volumePendingDeletion ?? null)} deletedAt=${observed.volumeDeletedAt ?? '(unset)'}.`],
			}));
			const deploymentHasVolumeMount = observed?.deploymentRequiredMountPath === service.volumeMountPath
				|| (observed?.deploymentVolumeMounts ?? []).includes(service.volumeMountPath);
			checks.push(check({
				id: `railway:${service.instanceKey}:deployment-required-mount`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} deployment metadata includes the volume mount.`,
				expected: { volumeMountPath: service.volumeMountPath },
				observed: observed ? {
					requiredMountPath: observed.deploymentRequiredMountPath ?? null,
					volumeMounts: observed.deploymentVolumeMounts ?? [],
				} : { skipped: true },
				status: observed ? (deploymentHasVolumeMount ? 'passed' : 'failed') : 'skipped',
				issues: !observed || deploymentHasVolumeMount ? [] : [`Expected deployment metadata to include volume mount ${service.volumeMountPath}.`],
			}));
		}

		for (const key of [...(RAILWAY_SECRET_KEYS_BY_SERVICE[service.key] ?? []), ...(RAILWAY_VARIABLE_KEYS_BY_SERVICE[service.key] ?? [])]) {
			const presence = valuePresence(values, observed, key, service.key);
			const status = presence.present ? 'passed' : observed ? 'failed' : 'skipped';
			checks.push(check({
				id: `railway:${service.instanceKey}:env:${key}`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} has ${key}.`,
				expected: { key, serviceTarget: service.key, present: true },
				observed: presence,
				status,
				issues: presence.present ? [] : observed ? [`${key} is missing for ${service.key}.`] : ['No live Railway variable observation was provided.'],
			}));
		}

		if (service.publicBaseUrl) {
			const baseUrl = service.publicBaseUrl.replace(/\/+$/u, '');
			checks.push({ ...httpStatus(`${baseUrl}${service.healthcheckPath ?? '/healthz'}`, options), id: `http:${service.instanceKey}:healthz`, serviceKey: service.key, serviceType, description: `${service.serviceName} health endpoint responds.` });
			if (service.key === 'api') {
				checks.push({ ...httpStatus(`${baseUrl}/healthz/deep`, options), id: `http:${service.instanceKey}:healthz-deep`, serviceKey: service.key, serviceType, description: `${service.serviceName} deep health endpoint responds.` });
			}
		}
	}

	const applicationConfigs = [
		...(includeWeb ? [deployConfig] : []),
		...discoverApplications(tenantRoot)
			.filter((application) => application.root !== resolve(tenantRoot))
			.filter((application) => !selectedAppId || application.id === selectedAppId)
			.map((application) => application.config),
	];
	const DatabaseService = applicationConfigs
		.map((config) => config.services?.treeseedDatabase)
		.find((service) => service?.enabled !== false);
	if (
		includeApi
		&& (selectedServiceKeys.size === 0 || selectedServiceKeys.has('treeseedDatabase'))
		&& DatabaseService?.enabled !== false
		&& DatabaseService?.provider === 'railway'
	) {
		const targets = DatabaseService.railway?.serviceTargets ?? [];
		checks.push(check({
			id: 'railway:treeseedDatabase:targets',
			provider: 'railway',
			serviceKey: 'treeseedDatabase',
			serviceType: 'treeseedDatabase',
			target,
			description: 'Treeseed database targets API and runner services.',
			expected: { serviceTargets: ['api', 'operationsRunner'] },
			observed: { serviceTargets: targets },
			status: targets.includes('api') && targets.includes('operationsRunner') ? 'passed' : 'failed',
			issues: targets.includes('api') && targets.includes('operationsRunner') ? [] : ['Treeseed database must target api and operationsRunner.'],
		}));
	}

	for (const service of Object.values(selectedAppId ? {} : deployConfig.services ?? {})) {
		if (service && typeof service === 'object' && service.enabled !== false && service.provider && !['railway'].includes(service.provider)) {
			checks.push(check({
				id: `provider:${service.provider}`,
				provider: 'railway',
				serviceType: 'unknown',
				target,
				description: `Unsupported hosted service provider ${service.provider}.`,
				expected: { supportedProviders: ['railway'] },
				observed: { provider: service.provider },
				status: 'warning',
				issues: [`Hosted service checker does not yet support provider ${service.provider}.`],
			}));
		}
	}

	const entryIds = new Set(registry.entries.map((entry: { id: string }) => entry.id));
	for (const key of includeApi ? ['TREESEED_DATABASE_URL', 'TREESEED_WEB_SERVICE_SECRET', 'TREESEED_PLATFORM_RUNNER_SECRET'] : []) {
		if (!entryIds.has(key)) {
			checks.push(check({
				id: `registry:${key}`,
				provider: 'railway',
				serviceType: 'unknown',
				target,
				description: `Environment registry declares ${key}.`,
				expected: { registryEntry: key },
				observed: { registryEntry: null },
				status: 'failed',
				issues: [`${key} is missing from the environment registry.`],
			}));
		}
	}

	const summary = {
		passed: checks.filter((entry) => entry.status === 'passed').length,
		failed: checks.filter((entry) => entry.status === 'failed').length,
		skipped: checks.filter((entry) => entry.status === 'skipped').length,
		warning: checks.filter((entry) => entry.status === 'warning').length,
	};
	return {
		target,
		tenantRoot: resolve(tenantRoot),
		generatedAt: (options.now ?? new Date()).toISOString(),
		summary,
		checks,
	};
}
