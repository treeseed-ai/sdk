import { buildCloudflarePagesFunctionBindings, cloudflareApiRequest, mergeCloudflarePagesDeploymentConfig } from "../../operations/services/deploy.ts";
import type { TreeseedReconcileAdapterInput, TreeseedUnitVerificationCheck, TreeseedUnitVerificationResult } from ".././contracts.ts";
import { collectCloudflareEnvironmentSync, verificationCheck } from './first-railway-domain-string.ts';
import { toDeployTarget } from './to-deploy-target.ts';
import { buildCloudflareEnv } from './build-workflow-meta-adapter.ts';

export function summarizeVerification(unitId: string, checks: TreeseedUnitVerificationCheck[], warnings: string[] = []): TreeseedUnitVerificationResult {
	const missing = checks.flatMap((check) => !check.exists ? [`${check.key}: ${check.issues.join('; ') || check.description}`] : []);
	const drifted = checks.flatMap((check) =>
		check.exists && (!check.configured || !check.ready || !check.verified || check.issues.length > 0)
			? [`${check.key}: ${check.issues.join('; ') || 'verification failed'}`]
			: [],
	);
	return {
		unitId,
		supported: true,
		exists: checks.every((check) => check.exists),
		configured: checks.every((check) => check.configured),
		ready: checks.every((check) => check.ready),
		verified: checks.every((check) => check.verified),
		checks,
		missing,
		drifted,
		warnings,
	};
}

export function unsupportedVerification(unitId: string, message: string): TreeseedUnitVerificationResult {
	return {
		unitId,
		supported: false,
		exists: false,
		configured: false,
		ready: false,
		verified: false,
		checks: [verificationCheck('unsupported', message, 'sdk', {
			exists: false,
			configured: false,
			ready: false,
			verified: false,
			issues: [message],
		})],
		missing: [message],
		drifted: [],
		warnings: [],
	};
}

export function syncPagesEnvironmentVariablesForTarget(input: TreeseedReconcileAdapterInput, { planOnly = false } = {}) {
	const target = toDeployTarget(input.context.target);
	if (target.kind !== 'persistent') {
		return { vars: [], secrets: [] };
	}
	const env = buildCloudflareEnv(input);
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const { state, vars, secrets } = collectCloudflareEnvironmentSync(input);
	if (!accountId || !state.pages?.projectName) {
		return { vars: [], secrets: [] };
	}
	const branchConfigKey = target.scope === 'prod' ? 'production' : 'preview';
	const plainVars = Object.fromEntries(
		Object.entries(vars)
			.filter(([, value]) => typeof value === 'string' && value.length > 0)
			.map(([key, value]) => [key, { type: 'plain_text', value }]),
	);
	const secretVars = Object.fromEntries(
		Object.entries(secrets)
			.filter(([, value]) => typeof value === 'string' && value.length > 0)
			.map(([key, value]) => [key, { type: 'secret_text', value }]),
	);
	const envVars = {
		...plainVars,
		...secretVars,
	};
	if (planOnly || Object.keys(envVars).length === 0) {
		return {
			vars: Object.keys(plainVars),
			secrets: Object.keys(secretVars),
		};
	}
	const projectPath = `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(state.pages.projectName)}`;
	const existing = cloudflareApiRequest(projectPath, { env, allowFailure: true });
	const deploymentConfigs = (existing?.result?.deployment_configs && typeof existing.result.deployment_configs === 'object')
		? existing.result.deployment_configs
		: {};
	const currentBranchConfig = (deploymentConfigs?.[branchConfigKey] && typeof deploymentConfigs[branchConfigKey] === 'object')
		? deploymentConfigs[branchConfigKey]
		: {};
	const mergedDeploymentConfigs = {
		...deploymentConfigs,
		[branchConfigKey]: {
			...mergeCloudflarePagesDeploymentConfig(currentBranchConfig, buildCloudflarePagesFunctionBindings(state)),
			env_vars: {
				...(currentBranchConfig?.env_vars ?? {}),
				...envVars,
			},
		},
	};
	cloudflareApiRequest(projectPath, {
		method: 'PATCH',
		env,
		body: {
			deployment_configs: mergedDeploymentConfigs,
		},
	});
	return {
		vars: Object.keys(plainVars),
		secrets: Object.keys(secretVars),
	};
}
