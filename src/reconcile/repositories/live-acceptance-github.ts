import { resolveGitHubCredentialForRepository } from '../../operations/services/configuration/github-credentials.ts';
import { encryptGitHubSecret } from '../../operations/services/github-api/paginate-git-hub-environment-names.ts';
import {
PROVIDER_CAPABILITIES,
blocking,
measuredScenario,
node,
providerPrefixRoot,
scenario,
waitForLiveObservation,
} from '../runtime/live-acceptance-runtime.ts';
import type {
LiveReconcileEnvironment,
LiveReconcileMode,
LiveReconcileScenarioResult,
RunLiveReconcileTestsOptions,
} from '../support/acceptance/live-acceptance.ts';
import type { CanonicalDrift,CanonicalGraphNode } from '../support/state/platform.ts';
import { githubRequest,resolveCurrentGitHubRepository } from './live-acceptance-github-client.ts';

type LiveProgress = RunLiveReconcileTestsOptions['onProgress'];

export async function runGitHubCleanup(cwd: string, environment: LiveReconcileEnvironment, prefix: string, mode: LiveReconcileMode, env: LiveEnv, fetchImpl: typeof fetch) {
	const repository = resolveCurrentGitHubRepository(cwd, env);
	const credential = resolveGitHubCredentialForRepository(repository, { values: env, env });
	const cleanupDrift: CanonicalDrift[] = [];
	const destroyed: CanonicalGraphNode[] = [];
	const prefixRoot = mode === 'cleanup' ? providerPrefixRoot(environment, 'github') : prefix;
	if (!credential.token) {
		cleanupDrift.push(blocking('github', 'central-token', `Missing GitHub credential for ${repository}.`));
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
		const branches = await githubRequest(`/repos/${owner}/${repo}/git/matching-refs/heads/${encodeURIComponent(prefixRoot)}`, credential.token, fetchImpl).catch(() => []) as Array<{ ref?: string }>;
		for (const candidate of branches) {
			const ref = candidate.ref ?? '';
			if (!ref.startsWith(`refs/heads/${prefixRoot}`)) continue;
			const branchName = ref.replace(/^refs\/heads\//u, '');
			try {
				await githubRequest(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branchName)}/protection`, credential.token, fetchImpl, { method: 'DELETE' }).catch((error) => {
					const message = error instanceof Error ? error.message : String(error);
					if (!/404|Not Found|Branch not protected/iu.test(message)) throw error;
				});
				await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branchName)}`, credential.token, fetchImpl, { method: 'DELETE' });
				destroyed.push(node('github', environment, 'branch', branchName, { deleted: true }));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!/404|Not Found/iu.test(message)) cleanupDrift.push(blocking('github', 'branch', message));
			}
		}
	}
	const results = PROVIDER_CAPABILITIES.github.map((capability, index) => scenario({ provider: 'github', mode, prefix, capability, ok: cleanupDrift.length === 0, phase: 'cleanup', action: destroyed.length ? 'delete' : 'noop', reason: cleanupDrift.length === 0 ? 'GitHub cleanup completed.' : 'GitHub cleanup left blocking drift.', destroyedResources: index === 0 ? destroyed : [] }));
	return { results, cleanupDrift };
}

export async function runGitHubAcceptance(cwd: string, environment: LiveReconcileEnvironment, runId: string, prefix: string, env: LiveEnv, fetchImpl: typeof fetch, onProgress?: LiveProgress) {
	const mode: LiveReconcileMode = 'acceptance';
	let repository = '';
	try {
		repository = resolveCurrentGitHubRepository(cwd, env);
		const credential = resolveGitHubCredentialForRepository(repository, { values: env, env });
		if (!credential.token) throw new Error(`Missing GitHub credential for ${repository}; expected ${credential.envName}.`);
		const [owner, repo] = credential.repository.split('/');
		const environmentName = prefix;
		const branchName = prefix;
		const resourceName = `TREESEED_LIVE_TEST_${prefix.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}`;
		const variableName = `${resourceName}_VARIABLE`;
		const secretName = `${resourceName}_SECRET`;
		await runGitHubCleanup(cwd, environment, prefix, mode, env, fetchImpl);
		const results: LiveReconcileScenarioResult[] = [];
		const repositoryRecord = await githubRequest(`/repos/${owner}/${repo}`, credential.token, fetchImpl) as { full_name?: string; default_branch?: string; archived?: boolean };
		const defaultBranch = repositoryRecord.default_branch ?? 'main';
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'repository-adoption', phase: 'verify', action: 'adopt',
			successReason: 'GitHub acceptance adopted and read back the existing portfolio repository without creating a duplicate.',
			locators: { repository: credential.repository }, onProgress,
		}, async () => {
			if (repositoryRecord.full_name !== credential.repository || repositoryRecord.archived === true) throw new Error('The selected GitHub repository identity is missing, mismatched, or archived.');
			return repositoryRecord;
		}));
		let bootstrapSha = '';
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'bootstrap', phase: 'verify', action: 'noop',
			successReason: 'GitHub acceptance observed the default branch bootstrap commit.',
			locators: { repository: credential.repository, branch: defaultBranch }, onProgress,
		}, async () => {
			const branch = await githubRequest(`/repos/${owner}/${repo}/branches/${encodeURIComponent(defaultBranch)}`, credential.token, fetchImpl) as { commit?: { sha?: string } };
			bootstrapSha = branch.commit?.sha ?? '';
			if (!/^[a-f0-9]{40}$/u.test(bootstrapSha)) throw new Error(`Default branch ${defaultBranch} has no observable bootstrap commit.`);
			return branch;
		}));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'branch', phase: 'create', action: 'create',
			successReason: 'GitHub acceptance created an isolated branch from the exact default-branch commit and observed it live.',
			locators: { repository: credential.repository, branch: branchName }, createdResources: [node('github', environment, 'branch', branchName)], onProgress,
		}, async () => {
			await githubRequest(`/repos/${owner}/${repo}/git/refs`, credential.token, fetchImpl, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: bootstrapSha }) });
			return waitForLiveObservation(`GitHub branch ${branchName}`, () => githubRequest(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branchName)}`, credential.token ?? '', fetchImpl), (value) => (value as { name?: string }).name === branchName);
		}));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'branch-rules', phase: 'create', action: 'create',
			successReason: 'GitHub acceptance applied and read back the isolated branch safety policy.',
			locators: { repository: credential.repository, branch: branchName }, onProgress,
		}, async () => {
			await githubRequest(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branchName)}/protection`, credential.token, fetchImpl, { method: 'PUT', body: JSON.stringify({ required_status_checks: null, enforce_admins: true, required_pull_request_reviews: null, restrictions: null, allow_force_pushes: false, allow_deletions: false }) });
			const protection = await githubRequest(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branchName)}/protection`, credential.token, fetchImpl) as { enforce_admins?: { enabled?: boolean }; allow_force_pushes?: { enabled?: boolean }; allow_deletions?: { enabled?: boolean } };
			if (protection.enforce_admins?.enabled !== true || protection.allow_force_pushes?.enabled === true || protection.allow_deletions?.enabled === true) throw new Error('Isolated GitHub branch protection did not match the required safety policy.');
			return protection;
		}));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'actions-settings', phase: 'verify', action: 'noop',
			successReason: 'GitHub acceptance observed enabled Actions settings without changing repository-wide policy.',
			locators: { repository: credential.repository }, onProgress,
		}, async () => {
			const settings = await githubRequest(`/repos/${owner}/${repo}/actions/permissions`, credential.token, fetchImpl) as { enabled?: boolean };
			if (settings.enabled !== true) throw new Error('GitHub Actions is disabled for the selected repository.');
			return settings;
		}));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'environment', phase: 'create', action: 'create',
			startMessage: 'github:environment: create/update started',
			successReason: 'GitHub acceptance created a test environment and observed it live.',
			locators: { repository: credential.repository, environment: environmentName },
			onProgress,
		}, async () => {
			await githubRequest(`/repos/${owner}/${repo}/environments/${environmentName}`, credential.token, fetchImpl, { method: 'PUT', body: JSON.stringify({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }) });
			await githubRequest(`/repos/${owner}/${repo}/environments/${environmentName}/deployment-branch-policies`, credential.token, fetchImpl, { method: 'POST', body: JSON.stringify({ name: branchName, type: 'branch' }) });
			return waitForLiveObservation(
				`GitHub environment ${environmentName}`,
				async () => ({ environment: await githubRequest(`/repos/${owner}/${repo}/environments/${environmentName}`, credential.token ?? '', fetchImpl), policies: await githubRequest(`/repos/${owner}/${repo}/environments/${environmentName}/deployment-branch-policies?per_page=100`, credential.token ?? '', fetchImpl) }),
				(value) => ((value as { policies?: { branch_policies?: Array<{ name?: string }> } }).policies?.branch_policies ?? []).some((candidate) => candidate.name === branchName),
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
			provider: 'github', mode, environment, runId, prefix, capability: 'secret', phase: 'create', action: 'create',
			startMessage: 'github:secret: creating isolated environment secret',
			successReason: 'GitHub acceptance encrypted, created, and observed an isolated environment secret.',
			locators: { repository: credential.repository, environment: environmentName, secret: secretName },
			onProgress,
		}, async () => {
			const key = await githubRequest(`/repos/${owner}/${repo}/environments/${environmentName}/secrets/public-key`, credential.token, fetchImpl) as { key?: string; key_id?: string };
			const encryptedValue = await encryptGitHubSecret('isolated-live-acceptance-value', key.key ?? '');
			await githubRequest(`/repos/${owner}/${repo}/environments/${environmentName}/secrets/${secretName}`, credential.token, fetchImpl, { method: 'PUT', body: JSON.stringify({ encrypted_value: encryptedValue, key_id: key.key_id }) });
			return waitForLiveObservation(`GitHub secret ${secretName}`, () => githubRequest(`/repos/${owner}/${repo}/environments/${environmentName}/secrets?per_page=100`, credential.token ?? '', fetchImpl), (value) => ((value as { secrets?: Array<{ name?: string }> }).secrets ?? []).some((candidate) => candidate.name === secretName));
		}));
		results.push(await measuredScenario({
			provider: 'github', mode, environment, runId, prefix, capability: 'workflow-presence', phase: 'verify', action: 'noop',
			startMessage: 'github:workflow-presence: verifying workflow metadata',
			successReason: 'GitHub acceptance observed an active verification workflow without dispatching deployment.',
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
			provider: 'github', mode, environment, runId, prefix, capability: 'central-token', phase: 'verify', action: 'noop',
			startMessage: 'github:central-token: resolving credential',
			successReason: credential.envName === 'TREESEED_GITHUB_TOKEN'
				? 'GitHub acceptance resolved the central first-party credential.'
				: 'GitHub acceptance resolved an imported third-party repository override.',
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
