import { resolveGitHubCredentialForRepository } from '../../operations/services/configuration/github-credentials.ts';
import type { CanonicalDrift, CanonicalGraphNode } from '../support/state/platform.ts';
import type {
	RunLiveReconcileTestsOptions,
	LiveReconcileEnvironment,
	LiveReconcileMode,
	LiveReconcileScenarioResult,
} from '../support/acceptance/live-acceptance.ts';
import { githubRequest, resolveCurrentGitHubRepository } from './live-acceptance-github-client.ts';
import {
	PROVIDER_CAPABILITIES,
	blocking,
	measuredScenario,
	node,
	providerPrefixRoot,
	scenario,
	waitForLiveObservation,
} from '../runtime/live-acceptance-runtime.ts';
import type { LiveAcceptanceEnv } from '../support/acceptance/live-acceptance-values.ts';

type LiveProgress = RunLiveReconcileTestsOptions['onProgress'];

export async function runGitHubCleanup(cwd: string, environment: LiveReconcileEnvironment, prefix: string, mode: LiveReconcileMode, env: LiveEnv, fetchImpl: typeof fetch) {
	const repository = resolveCurrentGitHubRepository(cwd, env);
	const credential = resolveGitHubCredentialForRepository(repository, { values: env, env });
	const cleanupDrift: CanonicalDrift[] = [];
	const destroyed: CanonicalGraphNode[] = [];
	const prefixRoot = mode === 'cleanup' ? providerPrefixRoot(environment, 'github') : prefix;
	if (!credential.token) {
		cleanupDrift.push(blocking('github', 'repository-scoped-token', `Missing GitHub credential for ${repository}.`));
	} else {
		const [owner, repo] = credential.repository.split('/');
		const variables = await githubRequest(`/repos/${owner}/${repo}/actions/variables?per_page=100`, credential.token, fetchImpl).catch(() => ({ variables: [] })) as { variables?: Array<{ name?: string }> };
		for (const variable of variables.variables ?? []) {
			const name = variable.name ?? '';
			if (!name.startsWith(`TREESEED_LIVE_TEST_${prefixRoot.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}`)) continue;
			try {
				await githubRequest(`/repos/${owner}/${repo}/actions/variables/${name}`, credential.token, fetchImpl, { method: 'DELETE' });
				destroyed.push(node('github', environment, 'variable', name, { deleted: true }));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!/404|Not Found/iu.test(message)) cleanupDrift.push(blocking('github', 'variable', message));
			}
		}
		const environments = await githubRequest(`/repos/${owner}/${repo}/environments?per_page=100`, credential.token, fetchImpl).catch(() => ({ environments: [] })) as { environments?: Array<{ name?: string }> };
		for (const candidate of environments.environments ?? []) {
			const name = candidate.name ?? '';
			if (!name.startsWith(prefixRoot)) continue;
			try {
				await githubRequest(`/repos/${owner}/${repo}/environments/${name}`, credential.token, fetchImpl, { method: 'DELETE' });
				destroyed.push(node('github', environment, 'environment', name, { deleted: true }));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!/404|Not Found/iu.test(message)) cleanupDrift.push(blocking('github', 'environment', message));
			}
		}
	}
	const results = PROVIDER_CAPABILITIES.github.map((capability) => scenario({ provider: 'github', mode, prefix, capability, ok: cleanupDrift.length === 0, phase: 'cleanup', action: destroyed.length ? 'delete' : 'noop', reason: cleanupDrift.length === 0 ? 'GitHub cleanup completed.' : 'GitHub cleanup left blocking drift.', destroyedResources: destroyed }));
	return { results, cleanupDrift };
}

export async function runGitHubAcceptance(cwd: string, environment: LiveReconcileEnvironment, runId: string, prefix: string, env: LiveEnv, fetchImpl: typeof fetch, onProgress?: LiveProgress) {
	const mode: LiveReconcileMode = 'acceptance';
	let repository = '';
	try {
		repository = resolveCurrentGitHubRepository(cwd, env);
		const credential = resolveGitHubCredentialForRepository(repository, { values: env, env });
		if (!credential.token) throw new Error(`Missing GitHub credential for ${repository}; expected ${credential.envName} or TREESEED_GITHUB_TOKEN fallback.`);
		const [owner, repo] = credential.repository.split('/');
		const environmentName = prefix;
		const variableName = `TREESEED_LIVE_TEST_${prefix.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}`;
		await runGitHubCleanup(cwd, environment, prefix, mode, env, fetchImpl);
		const results: LiveReconcileScenarioResult[] = [];
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'environment', phase: 'create', action: 'create',
			startMessage: 'github:environment: create/update started',
			successReason: 'GitHub acceptance created a test environment and observed it live.',
			locators: { repository: credential.repository, environment: environmentName },
			onProgress,
		}, async () => {
			await githubRequest(`/repos/${owner}/${repo}/environments/${environmentName}`, credential.token, fetchImpl, { method: 'PUT', body: JSON.stringify({}) });
			return waitForLiveObservation(
				`GitHub environment ${environmentName}`,
				() => githubRequest(`/repos/${owner}/${repo}/environments?per_page=100`, credential.token ?? '', fetchImpl),
				(value) => Array.isArray((value as { environments?: unknown[] }).environments)
					&& ((value as { environments?: Array<{ name?: string }> }).environments ?? []).some((candidate) => candidate.name === environmentName),
			);
		}));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'variable', phase: 'update', action: 'update',
			startMessage: 'github:variable: create/update started',
			successReason: 'GitHub acceptance created, updated, and observed a repository variable.',
			locators: { repository: credential.repository, variable: variableName },
			onProgress,
		}, async () => {
			await githubRequest(`/repos/${owner}/${repo}/actions/variables`, credential.token, fetchImpl, { method: 'POST', body: JSON.stringify({ name: variableName, value: 'created' }) }).catch(async (error) => {
				if (/already_exists|already exists|409/iu.test(error instanceof Error ? error.message : String(error))) {
					await githubRequest(`/repos/${owner}/${repo}/actions/variables/${variableName}`, credential.token ?? '', fetchImpl, { method: 'PATCH', body: JSON.stringify({ name: variableName, value: 'created' }) });
					return;
				}
				throw error;
			});
			await githubRequest(`/repos/${owner}/${repo}/actions/variables/${variableName}`, credential.token, fetchImpl, { method: 'PATCH', body: JSON.stringify({ name: variableName, value: 'updated' }) });
			return waitForLiveObservation(
				`GitHub variable ${variableName}`,
				() => githubRequest(`/repos/${owner}/${repo}/actions/variables/${variableName}`, credential.token ?? '', fetchImpl),
				(value) => (value as { name?: string; value?: string }).name === variableName && (value as { value?: string }).value === 'updated',
			);
		}));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'secret', phase: 'verify', action: 'noop',
			startMessage: 'github:secret: verifying public-key secret API access',
			successReason: 'GitHub acceptance observed repository public-key access for Actions secret encryption.',
			locators: { repository: credential.repository },
			onProgress,
		}, async () => githubRequest(`/repos/${owner}/${repo}/actions/secrets/public-key`, credential.token, fetchImpl)));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'workflow-dispatch', phase: 'verify', action: 'noop',
			startMessage: 'github:workflow-dispatch: verifying dispatchable workflow metadata',
			successReason: 'GitHub acceptance observed workflow metadata for dispatch routing.',
			locators: { repository: credential.repository },
			onProgress,
		}, async () => {
			const workflows = await githubRequest(`/repos/${owner}/${repo}/actions/workflows?per_page=100`, credential.token, fetchImpl) as { workflows?: Array<{ id?: number | string; path?: string; state?: string }> };
			const workflow = workflows.workflows?.find((candidate) => candidate.state === 'active') ?? workflows.workflows?.[0] ?? null;
			if (!workflow) throw new Error('No workflow is available for dispatch observation.');
			return workflow;
		}));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'workflow-observation', phase: 'verify', action: 'noop',
			startMessage: 'github:workflow-observation: reading workflow runs',
			successReason: 'GitHub acceptance observed workflow runs.',
			locators: { repository: credential.repository },
			onProgress,
		}, async () => githubRequest(`/repos/${owner}/${repo}/actions/runs?per_page=1`, credential.token, fetchImpl)));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'repository-scoped-token', phase: 'verify', action: 'noop',
			startMessage: 'github:repository-scoped-token: resolving credential',
			successReason: credential.fallbackUsed ? 'GitHub acceptance resolved fallback credential.' : 'GitHub acceptance resolved repository-scoped credential.',
			locators: { repository: credential.repository, credentialKey: credential.envName },
			onProgress,
		}, async () => credential));
		const cleanup = await runGitHubCleanup(cwd, environment, prefix, mode, env, fetchImpl);
		return { results, cleanupDrift: cleanup.cleanupDrift };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			results: PROVIDER_CAPABILITIES.github.map((capability) => scenario({ provider: 'github', mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason, locators: { repository } })),
			cleanupDrift: [],
		};
	}
}

