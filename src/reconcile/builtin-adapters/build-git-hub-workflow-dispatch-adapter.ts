import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { TreeseedReconcileAdapter, TreeseedReconcileAdapterInput } from ".././contracts.ts";
import { dispatchReconcileGitHubWorkflow, observeGitHubEnvironment, observeGitHubWorkflowRun } from ".././providers/github-private.ts";
import { buildDockerImage, inspectDockerAvailability, inspectDockerImage, inspectDockerManifest } from ".././providers/docker-private.ts";
import { buildGitHubEnv, repositoryFromUnit, workflowName } from './build-graph-only-adapter.ts';
import { genericObservedState, genericResult, genericVerification, noopDiff } from './to-deploy-target.ts';
import { summarizeVerification } from './summarize-verification.ts';
import { verificationCheck } from './first-railway-domain-string.ts';

export function buildGitHubWorkflowDispatchAdapter(): TreeseedReconcileAdapter {
	return {
		providerId: 'github',
		unitTypes: ['github-workflow-dispatch'],
		supports(unitType, providerId) {
			return unitType === 'github-workflow-dispatch' && providerId === 'github';
		},
		async refresh(input) {
			const repository = repositoryFromUnit(input);
			const workflow = workflowName(input.unit.spec.workflow, 'publish.yml');
			const branch = typeof input.unit.spec.branch === 'string' ? input.unit.spec.branch : null;
			const latest = await observeGitHubWorkflowRun({ repository, workflow, branch, env: buildGitHubEnv(input) });
			const authBlocked = Boolean(latest && typeof latest === 'object' && 'authAvailable' in latest && latest.authAvailable === false);
			return {
				...genericObservedState(input, Boolean(latest) && !authBlocked, authBlocked ? [String((latest as any).error ?? 'GitHub authentication is unavailable')] : []),
				status: latest && !authBlocked ? 'ready' : 'pending',
				live: { repository, workflow, branch, latest },
			};
		},
		diff(input) {
			if (input.observed.live?.latest?.authAvailable === false) {
				return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			}
			const latest = input.observed.live?.latest;
			const conclusion = typeof latest?.conclusion === 'string' ? latest.conclusion : null;
			const status = typeof latest?.status === 'string' ? latest.status : null;
			const expectedHeadSha = typeof input.unit.spec.expectedHeadSha === 'string' ? input.unit.spec.expectedHeadSha : null;
			const observedHeadSha = typeof latest?.headSha === 'string' ? latest.headSha : typeof latest?.head_sha === 'string' ? latest.head_sha : null;
			if (!input.observed.exists) {
				return { action: 'create', reasons: ['workflow dispatch has no observed run'], before: input.observed.live, after: input.unit.spec };
			}
			if (expectedHeadSha && observedHeadSha && observedHeadSha !== expectedHeadSha) {
				return { action: 'create', reasons: [`latest workflow run is for ${observedHeadSha}, expected ${expectedHeadSha}`], before: input.observed.live, after: input.unit.spec };
			}
			if (conclusion && conclusion !== 'success') {
				return { action: 'create', reasons: [`latest workflow run concluded ${conclusion}`], before: input.observed.live, after: input.unit.spec };
			}
			if (status && status !== 'completed' && input.unit.spec.wait === true) {
				return { action: 'create', reasons: [`latest workflow run is still ${status}`], before: input.observed.live, after: input.unit.spec };
			}
			return noopDiff();
		},
		async apply(input) {
			if (input.diff.action === 'noop') return genericResult(input);
			const result = await dispatchReconcileGitHubWorkflow({
				repository: repositoryFromUnit(input),
				workflow: workflowName(input.unit.spec.workflow, 'publish.yml'),
				branch: String(input.unit.spec.branch ?? 'staging'),
				inputs: typeof input.unit.spec.inputs === 'object' && input.unit.spec.inputs ? input.unit.spec.inputs as Record<string, string> : {},
				wait: input.unit.spec.wait === true,
				timeoutMs: typeof input.unit.spec.timeoutMs === 'number' ? input.unit.spec.timeoutMs : undefined,
				env: buildGitHubEnv(input),
			});
			return genericResult(input, { ...input.observed.live, result });
		},
		verify(input) {
			const latest = input.observed.live?.latest;
			const result = input.result?.state?.result && typeof input.result.state.result === 'object'
				? input.result.state.result as Record<string, unknown>
				: null;
			const observedRun = result?.runId ? result : latest;
			const expectedHeadSha = typeof input.unit.spec.expectedHeadSha === 'string' ? input.unit.spec.expectedHeadSha : null;
			const observedHeadSha = typeof observedRun?.headSha === 'string'
				? observedRun.headSha
				: typeof observedRun?.head_sha === 'string'
					? observedRun.head_sha
					: null;
			const status = typeof observedRun?.status === 'string' ? observedRun.status : null;
			const conclusion = typeof observedRun?.conclusion === 'string' ? observedRun.conclusion : null;
			const wait = input.unit.spec.wait === true;
			const issues = [
				...(expectedHeadSha && observedHeadSha && observedHeadSha !== expectedHeadSha
					? [`latest workflow run is for ${observedHeadSha}, expected ${expectedHeadSha}`]
					: []),
				...(wait && status && status !== 'completed'
					? [`workflow run is still ${status}`]
					: []),
				...(wait && status === 'completed' && conclusion !== 'success'
					? [`workflow run concluded ${conclusion ?? 'unknown'}`]
					: []),
			];
			return summarizeVerification(input.unit.unitId, [
				verificationCheck('github.workflow-run', 'GitHub workflow dispatch produced a successful observed run', 'api', {
					exists: Boolean(observedRun),
					configured: !expectedHeadSha || !observedHeadSha || observedHeadSha === expectedHeadSha,
					ready: !wait || status === 'completed',
					verified: Boolean(observedRun) && issues.length === 0,
					expected: {
						workflow: input.unit.spec.workflow,
						branch: input.unit.spec.branch,
						headSha: expectedHeadSha,
						wait,
						conclusion: wait ? 'success' : undefined,
					},
					observed: observedRun,
					issues,
				}),
			], input.observed.warnings);
		},
	};
}

export function buildPackageImageAdapter(): TreeseedReconcileAdapter {
	return {
		providerId: 'dockerhub',
		unitTypes: ['package-image'],
		supports(unitType, providerId) {
			return unitType === 'package-image' && providerId === 'dockerhub';
		},
		async refresh(input) {
			const env = buildGitHubEnv(input);
			const repository = typeof input.unit.spec.repository === 'string' ? input.unit.spec.repository : null;
			const environment = typeof input.unit.spec.environment === 'string' ? input.unit.spec.environment : 'staging';
			const requiredSecrets = Array.isArray(input.unit.spec.requiredSecrets)
				? input.unit.spec.requiredSecrets.map((entry) => String(entry)).filter(Boolean)
				: ['TREESEED_DOCKERHUB_TOKEN'];
			const requiredVariables = Array.isArray(input.unit.spec.requiredVariables)
				? input.unit.spec.requiredVariables.map((entry) => String(entry)).filter(Boolean)
				: ['TREESEED_DOCKERHUB_USERNAME'];
			const localMissingSecrets = requiredSecrets.filter((name) => !env[name]);
			const localMissingVariables = requiredVariables.filter((name) => !env[name]);
			let remote: Awaited<ReturnType<typeof observeGitHubEnvironment>> | null = null;
			if ((localMissingSecrets.length > 0 || localMissingVariables.length > 0) && repository) {
				remote = await observeGitHubEnvironment(repository, environment, env);
			}
			const remoteSecretNames = new Set(remote?.secretNames ?? []);
			const remoteVariableNames = new Set(remote?.variableNames ?? []);
			const missingSecrets = localMissingSecrets.filter((name) => !remoteSecretNames.has(name));
			const missingVariables = localMissingVariables.filter((name) => !remoteVariableNames.has(name));
			const usernameConfigured = missingVariables.length === 0;
			const tokenConfigured = missingSecrets.length === 0;
			return {
				...genericObservedState(input, usernameConfigured && tokenConfigured, [
					...missingVariables.map((name) => `${name} is not configured`),
					...missingSecrets.map((name) => `${name} is not configured`),
				]),
				status: usernameConfigured && tokenConfigured ? 'ready' : 'pending',
				live: {
					...input.unit.spec,
					dockerHub: {
						usernameConfigured,
						tokenConfigured,
						source: localMissingSecrets.length === 0 && localMissingVariables.length === 0 ? 'local-env' : 'github-environment',
						environment,
						repository,
					},
				},
			};
		},
		diff(input) {
			return input.observed.exists ? noopDiff() : { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
		},
		apply(input) {
			return genericResult(input);
		},
		verify(input) {
			return genericVerification(input, input.observed, 'Docker Hub credentials for package image publication are configured');
		},
	};
}

export function buildDockerImageBuildAdapter(): TreeseedReconcileAdapter {
	return {
		providerId: 'docker',
		unitTypes: ['docker-image-build'],
		supports(unitType, providerId) {
			return unitType === 'docker-image-build' && providerId === 'docker';
		},
		refresh(input) {
			const availability = inspectDockerAvailability();
			const tags = Array.isArray(input.unit.spec.tags) ? input.unit.spec.tags.filter((entry): entry is string => typeof entry === 'string') : [];
			const inspectedImages = Object.fromEntries(tags.map((tag) => [tag, inspectDockerImage(tag)]));
			const inspectedManifests = Object.fromEntries(tags.map((tag) => [tag, inspectDockerManifest(tag)]));
			const exists = availability.available && availability.buildxAvailable;
			return {
				...genericObservedState(input, exists, availability.warnings),
				status: !exists ? 'error' : tags.some((tag) => inspectedImages[tag] || inspectedManifests[tag]) ? 'ready' : 'pending',
				live: {
					...input.unit.spec,
					docker: availability,
					tags,
					inspectedImages,
					inspectedManifests,
				},
			};
		},
		diff(input) {
			if (!input.observed.exists) {
				return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			}
			const tags = Array.isArray(input.unit.spec.tags) ? input.unit.spec.tags.filter((entry): entry is string => typeof entry === 'string') : [];
			const inspectedImages = input.observed.live.inspectedImages as Record<string, unknown> | undefined;
			const inspectedManifests = input.observed.live.inspectedManifests as Record<string, unknown> | undefined;
			const missing = tags.filter((tag) => !inspectedImages?.[tag] && !inspectedManifests?.[tag]);
			return missing.length > 0
				? { action: 'create', reasons: [`missing docker image tags: ${missing.join(', ')}`], before: input.observed.live, after: input.unit.spec }
				: noopDiff();
		},
		apply(input) {
			if (input.diff.action === 'blocked' || input.diff.action === 'noop') return genericResult(input);
			const platforms = Array.isArray(input.unit.spec.platforms) ? input.unit.spec.platforms.filter((entry): entry is string => typeof entry === 'string') : ['linux/amd64'];
			const tags = Array.isArray(input.unit.spec.tags) ? input.unit.spec.tags.filter((entry): entry is string => typeof entry === 'string') : [];
			runDockerImagePrepareCommand(input);
			const result = buildDockerImage({
				tenantRoot: input.context.tenantRoot,
				packageRoot: String(input.unit.spec.packageRoot ?? input.context.tenantRoot),
				context: String(input.unit.spec.context ?? '.'),
				dockerfile: String(input.unit.spec.dockerfile ?? 'Dockerfile'),
				target: typeof input.unit.spec.target === 'string' ? input.unit.spec.target : null,
				platforms,
				tags,
				labels: typeof input.unit.spec.labels === 'object' && input.unit.spec.labels ? input.unit.spec.labels as Record<string, string> : {},
				buildArgs: typeof input.unit.spec.buildArgs === 'object' && input.unit.spec.buildArgs ? input.unit.spec.buildArgs as Record<string, string> : {},
				push: input.unit.spec.push === true,
				load: input.unit.spec.load !== false,
				provenance: input.unit.spec.provenance === false ? false : undefined,
				env: input.context.launchEnv,
			});
			return genericResult(input, { ...input.observed.live, build: result });
		},
		verify(input) {
			const tags = Array.isArray(input.unit.spec.tags) ? input.unit.spec.tags.filter((entry): entry is string => typeof entry === 'string') : [];
			const checks = tags.map((tag) => {
				const image = inspectDockerImage(tag);
				const manifest = inspectDockerManifest(tag);
				const ok = Boolean(image || manifest);
				return verificationCheck(`docker-image:${tag}`, `Docker image ${tag} exists locally or as an inspectable manifest`, 'cli', {
					exists: ok,
					configured: input.observed.exists,
					ready: ok,
					verified: ok,
					observed: image ?? manifest,
					issues: ok ? [] : [`Docker image ${tag} was not found after build.`],
				});
			});
			return summarizeVerification(input.unit.unitId, checks.length > 0 ? checks : [
				verificationCheck('docker', 'Docker daemon and Buildx are available', 'cli', {
					exists: input.observed.exists,
					configured: input.observed.exists,
					ready: input.observed.exists,
					verified: input.observed.exists,
				}),
			], input.observed.warnings);
		},
	};
}

export function runDockerImagePrepareCommand(input: TreeseedReconcileAdapterInput) {
	const prepareCommand = input.unit.spec.prepareCommand;
	if (!prepareCommand || typeof prepareCommand !== 'object') return;
	const command = typeof (prepareCommand as Record<string, unknown>).command === 'string'
		? String((prepareCommand as Record<string, unknown>).command)
		: null;
	const rawArgs = (prepareCommand as Record<string, unknown>).args;
	const args = Array.isArray(rawArgs)
		? rawArgs.filter((entry): entry is string => typeof entry === 'string')
		: [];
	if (!command) return;
	const packageRoot = resolve(input.context.tenantRoot, String(input.unit.spec.packageRoot ?? '.'));
	const result = spawnSync(command, args, {
		cwd: packageRoot,
		env: { ...process.env, ...(input.context.launchEnv ?? {}) },
		encoding: 'utf8',
		stdio: 'pipe',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} ${args.join(' ')} failed`);
	}
}
