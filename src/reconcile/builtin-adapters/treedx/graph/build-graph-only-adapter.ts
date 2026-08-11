import { withDockerhubServiceCredentialEnv } from "../../../../configuration/service-credentials.ts";
import { resolveMachineEnvironmentValues } from "../../../../operations/services/configuration/config-runtime.ts";
import { resolveGitHubCredentialForRepository } from "../../../../operations/services/configuration/github-credentials.ts";
import { ensureReconcileGitHubEnvironment,observeGitHubEnvironment,observeReconcileGitHubBranch,upsertReconcileGitHubSecret,upsertReconcileGitHubVariable } from "../../../providers/github-private.ts";
import type { ReconcileAdapter,ReconcileAdapterInput,ReconcileUnitType } from "../../../support/contracts/contracts.ts";
import { genericObservedState,genericResult,genericVerification,noopDiff } from '../../hosting/to-deploy-target.ts';
import { normalizeEnvironmentValues,resolveReconcileEnvironmentValues } from '../../reconciliation/build-workflow-meta-adapter.ts';

export function buildGraphOnlyAdapter(providerId: string, unitTypes: ReconcileUnitType[], description: string): ReconcileAdapter {
	return {
		providerId,
		unitTypes,
		supports(unitType, candidateProviderId) {
			return candidateProviderId === providerId && unitTypes.includes(unitType);
		},
		refresh(input) {
			return genericObservedState(input);
		},
		diff() {
			return noopDiff();
		},
		apply(input) {
			return genericResult(input);
		},
		verify(input) {
			return genericVerification(input, input.observed, description);
		},
		destroy(input) {
			return genericResult({
				...input,
				diff: { action: 'delete', reasons: ['selected for destroy'], before: input.observed.live, after: {} },
			});
		},
	};
}

export function buildGitHubEnv(input: ReconcileAdapterInput) {
	const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
	const resolvedScope = scope === 'local' ? 'staging' : scope;
	const configuredValues = resolveMachineEnvironmentValues(input.context.tenantRoot, resolvedScope);
	const values = {
		...normalizeEnvironmentValues(configuredValues),
		...resolveReconcileEnvironmentValues(input, resolvedScope),
	};
	const providerValues = withDockerhubServiceCredentialEnv(values);
	const repository = typeof input.unit.spec.repository === 'string' ? input.unit.spec.repository : null;
	if (!repository) return providerValues;
	const credential = resolveGitHubCredentialForRepository(repository, { values: providerValues, env: providerValues });
	return credential.token
		? { ...providerValues, TREESEED_GITHUB_TOKEN: credential.token, GH_TOKEN: credential.token, GITHUB_TOKEN: credential.token }
		: providerValues;
}

export function repositoryFromUnit(input: ReconcileAdapterInput) {
	const repository = input.unit.spec.repository;
	if (typeof repository !== 'string' || !repository.trim()) {
		throw new Error(`${input.unit.unitId} requires a GitHub repository.`);
	}
	return repository.trim();
}

export function workflowName(value: unknown, fallback: string) {
	return (typeof value === 'string' && value.trim() ? value.trim() : fallback).replace(/^\.github\/workflows\//u, '');
}

export function environmentFromUnit(input: ReconcileAdapterInput) {
	const environment = input.unit.spec.environment;
	if (typeof environment !== 'string' || !environment.trim()) {
		throw new Error(`${input.unit.unitId} requires a GitHub environment.`);
	}
	return environment.trim();
}

export function buildGitHubEnvironmentAdapter(): ReconcileAdapter {
	const matchesBranchPolicy = (live: Record<string, unknown>, branch: string | null) => {
		if (!branch) return true;
		const policy = live.deploymentBranchPolicy as { protected_branches?: boolean; custom_branch_policies?: boolean } | null;
		const branches = Array.isArray(live.branchPolicies) ? live.branchPolicies as Array<{ name?: string; type?: string }> : [];
		return policy?.protected_branches === false
			&& policy.custom_branch_policies === true
			&& branches.length === 1
			&& branches[0]?.type === 'branch'
			&& branches[0]?.name === branch;
	};
	return {
		providerId: 'github',
		unitTypes: ['github-environment'],
		supports(unitType, providerId) {
			return unitType === 'github-environment' && providerId === 'github';
		},
		async refresh(input) {
			const repository = repositoryFromUnit(input);
			const environment = environmentFromUnit(input);
			const branch = typeof input.unit.spec.branch === 'string' ? input.unit.spec.branch : null;
			const env = buildGitHubEnv(input);
			const [observed, observedBranch] = await Promise.all([
				observeGitHubEnvironment(repository, environment, env),
				branch ? observeReconcileGitHubBranch(repository, branch, env) : Promise.resolve(null),
			]);
			const configured = observed.exists && matchesBranchPolicy(observed, branch);
			const warnings = observed.exists
				? []
				: [String(observed.error ?? 'GitHub environment is missing')];
			return {
				...genericObservedState(input, observed.exists, warnings),
				status: configured ? 'ready' : observed.exists ? 'drifted' : 'pending',
				live: { ...observed, branchExists: observedBranch?.exists ?? true },
			};
		},
		diff(input) {
			if (input.observed.live?.authAvailable === false) {
				return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			}
			if (input.observed.live.branchExists !== true) return { action: 'blocked', reasons: ['GitHub environment cannot be reconciled before its deployment branch exists.'], before: input.observed.live, after: input.unit.spec };
			if (!input.observed.exists) return { action: 'create', reasons: ['GitHub environment is missing'], before: input.observed.live, after: input.unit.spec };
			const branch = typeof input.unit.spec.branch === 'string' ? input.unit.spec.branch : null;
			return matchesBranchPolicy(input.observed.live, branch)
				? noopDiff()
				: { action: 'update', reasons: [`GitHub environment branch policy must allow only ${branch}.`], before: input.observed.live, after: input.unit.spec };
		},
		async apply(input) {
			if (input.diff.action === 'create' || input.diff.action === 'update') {
				const result = await ensureReconcileGitHubEnvironment(repositoryFromUnit(input), environmentFromUnit(input), typeof input.unit.spec.branch === 'string' ? input.unit.spec.branch : null, buildGitHubEnv(input));
				return genericResult(input, { ...input.observed.live, result });
			}
			return genericResult(input);
		},
		verify(input) {
			const branch = typeof input.unit.spec.branch === 'string' ? input.unit.spec.branch : null;
			const configured = input.observed.exists && matchesBranchPolicy(input.observed.live, branch);
			return {
				unitId: input.unit.unitId, supported: true, exists: input.observed.exists, configured, ready: configured, verified: configured,
				checks: [{ key: 'github.environment-policy', description: 'GitHub environment and branch policy match desired state', source: 'api', exists: input.observed.exists, configured, ready: configured, verified: configured, expected: { branch }, observed: input.observed.live, issues: configured ? [] : ['Environment or branch policy drifted.'] }],
				missing: input.observed.exists ? [] : ['github.environment'], drifted: input.observed.exists && !configured ? ['github.environment-policy'] : [], warnings: input.observed.warnings,
			};
		},
	};
}

export function buildGitHubBindingAdapter(unitType: 'github-secret-binding' | 'github-variable-binding'): ReconcileAdapter {
	return {
		providerId: 'github',
		unitTypes: [unitType],
		supports(candidateUnitType, providerId) {
			return candidateUnitType === unitType && providerId === 'github';
		},
		async refresh(input) {
			const repository = repositoryFromUnit(input);
			const environment = environmentFromUnit(input);
			const nameKey = unitType === 'github-secret-binding' ? 'secretName' : 'variableName';
			const name = String(input.unit.spec[nameKey] ?? input.unit.spec.envName ?? '');
			const observed = await observeGitHubEnvironment(repository, environment, buildGitHubEnv(input));
			const names = unitType === 'github-secret-binding' ? observed.secretNames : observed.variableNames;
			const exists = observed.exists && names.includes(name);
			const value = unitType === 'github-variable-binding'
				? String((observed.variableValues as Record<string, string> | undefined)?.[name] ?? '')
				: null;
			const warnings = observed.authAvailable === false
				? [String(observed.error ?? 'GitHub authentication is unavailable')]
				: observed.exists ? [] : [`GitHub environment ${environment} is missing`];
			return {
				...genericObservedState(input, exists, warnings),
				status: exists ? 'ready' : 'pending',
				live: { repository, environment, name, exists, value, observed },
			};
		},
		diff(input) {
			const name = String(input.observed.live.name ?? '');
			if (input.observed.live?.observed?.authAvailable === false) {
				return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			}
			const value = buildGitHubEnv(input)[name];
			if (!value) {
				return { action: 'blocked', reasons: [`Missing local value for ${name}`], before: input.observed.live, after: input.unit.spec };
			}
			if (input.observed.exists) {
				if (unitType === 'github-variable-binding') {
					const observedValue = String(input.observed.live.value ?? '');
					if (observedValue !== value) {
						return {
							action: 'update',
							reasons: [`GitHub variable ${name} value drifted`],
							before: input.observed.live,
							after: input.unit.spec,
						};
					}
				}
				return noopDiff();
			}
			return { action: 'update', reasons: [`GitHub ${unitType === 'github-secret-binding' ? 'secret' : 'variable'} ${name} is missing`], before: input.observed.live, after: input.unit.spec };
		},
		async apply(input) {
			if (input.diff.action === 'noop' || input.diff.action === 'blocked') return genericResult(input);
			const name = String(input.observed.live.name ?? input.unit.spec.envName ?? '');
			const value = buildGitHubEnv(input)[name];
			if (!value) throw new Error(`Missing local value for ${name}`);
			const result = unitType === 'github-secret-binding'
				? await upsertReconcileGitHubSecret(repositoryFromUnit(input), environmentFromUnit(input), name, value, buildGitHubEnv(input))
				: await upsertReconcileGitHubVariable(repositoryFromUnit(input), environmentFromUnit(input), name, value, buildGitHubEnv(input));
			return genericResult(input, { ...input.observed.live, result });
		},
		verify(input) {
			return genericVerification(input, input.observed, `GitHub ${unitType === 'github-secret-binding' ? 'secret' : 'variable'} binding exists`);
		},
	};
}
