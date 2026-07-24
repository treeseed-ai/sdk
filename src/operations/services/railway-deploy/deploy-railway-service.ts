import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadCliDeployConfig } from '../agents/runtime-tools.ts';
import { resolveMachineEnvironmentValues } from '../configuration/config-runtime.ts';
import { createPersistentDeployTarget, resolveResourceIdentity } from '../hosting/deployment/deploy.ts';
import { classifyGitMode, runGitText } from '../operations/git-runner.ts';
import { discoverApplications } from '../../../hosting/apps.ts';
import { apiRailwayDefaultDockerfilePath, apiRailwayDefaultSourceRepo, assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService, railwayEnvironmentQualifiedServiceName, railwayTreeDxServiceName } from '../hosting/railway/railway-source-policy.ts';
import { runPrefixedCommand, sleep, type BootstrapTaskPrefix, type BootstrapWriter } from '../operations/bootstrap-runner.ts';
import {
	ensureRailwayEnvironment,
	ensureRailwayProject,
	ensureRailwayService,
	ensureRailwayServiceInstanceConfiguration,
	ensureRailwayServiceVolume,
	deployRailwayServiceInstance,
	getRailwayServiceInstance,
	listRailwayEnvironments,
	listRailwayProjects,
	listRailwayServices,
	listRailwayVolumes,
	normalizeRailwayEnvironmentName,
	railwayGraphqlRequest,
	resolveRailwayApiToken,
	resolveRailwayApiUrl,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
	upsertRailwayVariables,
} from '../hosting/railway/railway-api.ts';
import { elapsedMs, formatDurationMs, type TimingEntry } from '../../../entrypoints/runtime/timing.ts';
import { normalizeScope, railwayDeployTransport, timedRailwayPhase } from './normalize-scope.ts';
import { railwayPhaseTimeoutMs, resolveRailwayDeployProjectContext, shouldRunRailwayPredeployBuild, syncRailwayApiDeviceLoginVariables, withRailwayPhaseTimeout } from './verify-railway-managed-resources.ts';
import { buildRailwayCommandEnv } from './railway-status-deployment-terminal-failure.ts';
import { syncRailwayServiceRuntimeConfigurationAfterDeploy } from './sync-railway-service-runtime-configuration-after-deploy.ts';

export async function deployRailwayService(
	tenantRoot,
	service,
	{
		planOnly = false,
		write,
		prefix,
		env = process.env,
		fetchImpl = fetch,
	}: {
		planOnly?: boolean;
		write?: BootstrapWriter;
		prefix?: BootstrapTaskPrefix;
		env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
		fetchImpl?: typeof fetch;
	} = {},
) {
	const timings: TimingEntry[] = [];
	if (planOnly) {
		return {
			service: service.key,
			status: 'planned',
			command: 'railway-cli service redeploy',
			cwd: service.rootDir,
			publicBaseUrl: service.publicBaseUrl,
			timings,
			transport: {
				railway: {
					reconcile: 'api',
					deploy: railwayDeployTransport(env),
				},
			},
		};
	}
	const deployService = await timedRailwayPhase(timings, 'railway:resolve-context', () => resolveRailwayDeployProjectContext(service, { env, fetchImpl }), {
		service: service.key,
	});
	const commandEnv = buildRailwayCommandEnv({ ...process.env, ...env });
	const deployTransport = railwayDeployTransport(commandEnv);

	const taskPrefix = prefix ?? {
		scope: normalizeScope(deployService.scope ?? deployService.railwayEnvironment ?? 'railway'),
		system: deployService.key === 'api' ? 'api' : 'agents',
		task: `${deployService.key}-railway-deploy`,
		stage: 'deploy',
	};
	const writePhase = (stage, message) => {
		write ? write(`[${taskPrefix.scope}][${taskPrefix.system}][${taskPrefix.task}][${stage}] ${message}`, 'stdout') : null;
	};
	writePhase('resolve-context', `Resolved Railway service ${deployService.serviceName ?? deployService.serviceId ?? deployService.key}.`);
	writePhase('sync-runtime-config', 'Syncing Railway runtime configuration.');
	const runtimeConfiguration = await timedRailwayPhase(timings, 'railway:sync-runtime-config', () => withRailwayPhaseTimeout(
		() => syncRailwayServiceRuntimeConfigurationAfterDeploy(tenantRoot, deployService, { env: commandEnv, writePhase, fetchImpl }),
		railwayPhaseTimeoutMs(commandEnv, 'sync_runtime_config'),
		`Railway runtime configuration sync timed out for ${deployService.serviceName ?? deployService.key}.`,
	), { service: deployService.key });
	const cliDeployService = {
		...deployService,
		projectId: runtimeConfiguration?.projectId ?? deployService.projectId,
		projectName: runtimeConfiguration?.projectName ?? deployService.projectName,
		environmentId: runtimeConfiguration?.environmentId ?? deployService.environmentId,
		serviceId: runtimeConfiguration?.serviceId ?? deployService.serviceId,
		serviceName: runtimeConfiguration?.serviceName ?? deployService.serviceName,
		railwayEnvironment: runtimeConfiguration?.environmentName ?? runtimeConfiguration?.environmentId ?? deployService.railwayEnvironment,
	};
	writePhase('device-login-vars', 'Syncing Railway device-login variables.');
	await timedRailwayPhase(timings, 'railway:device-login-vars', () => withRailwayPhaseTimeout(
		() => syncRailwayApiDeviceLoginVariables(cliDeployService, commandEnv, write, taskPrefix, fetchImpl),
		railwayPhaseTimeoutMs(commandEnv, 'device_login_vars'),
		`Railway device-login variable sync timed out for ${cliDeployService.serviceName ?? cliDeployService.key}.`,
	), {
		service: cliDeployService.key,
	});
		if (deployService.buildCommand && !deployService.imageRef && shouldRunRailwayPredeployBuild(commandEnv)) {
		const buildResult = await timedRailwayPhase(timings, 'railway:predeploy-build', () => runPrefixedCommand('bash', ['-lc', deployService.buildCommand], {
			cwd: deployService.rootDir,
			env: commandEnv,
			write,
			prefix: { ...taskPrefix, stage: 'build' },
		}), { service: deployService.key });
		if (buildResult.status !== 0) {
			throw new Error(`Railway ${deployService.key} build command failed.`);
		}
	}
	if (deployTransport !== 'cli-fallback') {
		writePhase('deploy', `Deploying Railway service ${cliDeployService.serviceName ?? cliDeployService.serviceId ?? cliDeployService.key} through the managed Railway CLI.`);
		const apiDeploy = await timedRailwayPhase(timings, 'railway:api-deploy', () => withRailwayPhaseTimeout(
			() => deployRailwayServiceInstance({
				projectId: cliDeployService.projectId,
				serviceId: cliDeployService.serviceId,
				environmentId: cliDeployService.environmentId,
				env: commandEnv,
				fetchImpl,
			}),
			railwayPhaseTimeoutMs(commandEnv, 'deploy'),
			`Railway API deploy phase timed out for ${cliDeployService.serviceName ?? cliDeployService.key}.`,
		), { service: cliDeployService.key });
		return {
			service: deployService.key,
			status: 'deployed',
			command: 'railway-cli service redeploy',
			cwd: deployService.rootDir,
			publicBaseUrl: deployService.publicBaseUrl,
			timings,
			deploymentId: apiDeploy.deploymentId,
			transport: {
				railway: {
					reconcile: 'api',
					deploy: 'api',
				},
			},
			runtimeConfiguration: runtimeConfiguration
				? {
					updated: runtimeConfiguration.updated,
					healthcheckPath: runtimeConfiguration.instance?.healthcheckPath ?? null,
					healthcheckTimeoutSeconds: runtimeConfiguration.instance?.healthcheckTimeoutSeconds ?? null,
					runtimeMode: runtimeConfiguration.instance?.runtimeMode ?? null,
					volume: runtimeConfiguration.volume ?? null,
				}
				: null,
		};
	}
	throw new Error(`Railway deployment for ${cliDeployService.serviceName ?? cliDeployService.serviceId ?? cliDeployService.key} requires Railway API deployment support. CLI deploy fallback has been removed.`);
}
