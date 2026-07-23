import { existsSync } from 'node:fs';
import { createBranchPreviewDeployTarget, createPersistentDeployTarget } from "../../operations/services/deploy.ts";
import type { TreeseedObservedUnitState, TreeseedReconcileAdapter, TreeseedReconcileAdapterInput, TreeseedReconcileResult, TreeseedReconcileTarget, TreeseedReconcileUnitDiff, TreeseedUnitVerificationResult, TreeseedReconcileUnitType } from ".././contracts.ts";
import { findTreeseedPackageAdapter, syncTreeseedPackageWorkflows } from "../../operations/services/package-adapters.ts";
import { summarizeVerification } from './summarize-verification.ts';
import { verificationCheck } from './first-railway-domain-string.ts';

export function toDeployTarget(target: TreeseedReconcileTarget) {
	return target.kind === 'persistent'
		? createPersistentDeployTarget(target.scope)
		: createBranchPreviewDeployTarget(target.branchName);
}

export function nowIso() {
	return new Date().toISOString();
}

export function sleepMs(durationMs: number) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

export function isTransientCloudflareReconcileError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|connectivity issue/iu.test(message);
}

export function isTransientRailwayReconcileError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|connectivity issue|rate limit|too many requests|429|5\d\d|operation is already in progress|Problem processing request/iu.test(message);
}

export function noopObservedState(input: TreeseedReconcileAdapterInput): TreeseedObservedUnitState {
	return {
		exists: true,
		status: 'ready',
		live: {
			unitId: input.unit.unitId,
			dependencies: input.unit.dependencies,
		},
		locators: {},
		warnings: [],
	};
}

export function noopDiff(): TreeseedReconcileUnitDiff {
	return {
		action: 'noop',
		reasons: ['composite unit'],
		before: {},
		after: {},
	};
}

export function buildCompositeAdapter(unitType: TreeseedReconcileUnitType): TreeseedReconcileAdapter {
	return {
		providerId: 'treeseed',
		unitTypes: [unitType],
		supports(candidateUnitType, providerId) {
			return candidateUnitType === unitType && providerId === 'treeseed';
		},
		async refresh(input) {
			return noopObservedState(input);
		},
		diff() {
			return noopDiff();
		},
		requiredPostconditions({ unit }) {
			return unit.dependencies.map((dependency) => ({
				key: dependency,
				description: `Dependency ${dependency} is verified`,
			}));
		},
		apply({ unit, observed, diff }) {
			return {
				unit,
				observed,
				diff,
				action: diff.action,
				warnings: [],
				resourceLocators: {},
				state: {
					unitId: unit.unitId,
					reconciledAt: nowIso(),
				},
				verification: null,
			};
		},
		verify({ context, unit, postconditions }) {
			const dependencyResults = context.session.get('treeseed:verification-results') as Map<string, TreeseedUnitVerificationResult> | undefined;
			const checks = postconditions.map((condition) => {
				const dependency = dependencyResults?.get(condition.key);
				const verified = dependency?.verified === true;
				return {
					key: condition.key,
					description: condition.description,
					source: 'derived' as const,
					exists: verified,
					configured: verified,
					ready: verified,
					verified,
					expected: true,
					observed: dependency?.verified ?? false,
					issues: verified ? [] : [`Dependency ${condition.key} is not verified.`],
				};
			});
			return summarizeVerification(unit.unitId, checks);
		},
	};
}

export function genericObservedState(input: TreeseedReconcileAdapterInput, exists = true, warnings: string[] = []): TreeseedObservedUnitState {
	return {
		exists,
		status: exists ? 'ready' : 'pending',
		live: {
			unitId: input.unit.unitId,
			unitType: input.unit.unitType,
			provider: input.unit.provider,
			spec: input.unit.spec,
		},
		locators: { unitId: input.unit.unitId },
		warnings,
	};
}

export function genericResult(input: TreeseedReconcileAdapterInput & { observed: TreeseedObservedUnitState; diff: TreeseedReconcileUnitDiff }, state: Record<string, unknown> = input.observed.live): TreeseedReconcileResult {
	return {
		unit: input.unit,
		observed: input.observed,
		diff: input.diff,
		action: input.diff.action,
		warnings: input.observed.warnings,
		resourceLocators: input.observed.locators,
		state: {
			...state,
			reconciledAt: nowIso(),
		},
		verification: null,
	};
}

export function genericVerification(input: TreeseedReconcileAdapterInput, observed: TreeseedObservedUnitState, description = 'Desired resource is represented in the canonical graph') {
	return summarizeVerification(input.unit.unitId, [
		verificationCheck('desired-resource', description, 'derived', {
			exists: observed.exists,
			configured: true,
			ready: observed.status !== 'error',
			verified: observed.exists && observed.status !== 'error',
			observed: observed.live,
		}),
	], observed.warnings);
}

export function buildManifestAdapter(): TreeseedReconcileAdapter {
	return {
		providerId: 'treeseed',
		unitTypes: ['package-manifest', 'template-manifest'],
		supports(unitType, providerId) {
			return (unitType === 'package-manifest' || unitType === 'template-manifest') && providerId === 'treeseed';
		},
		async refresh(input) {
			const manifestPath = typeof input.unit.spec.manifestPath === 'string' ? input.unit.spec.manifestPath : null;
			const warningLabel = input.unit.unitType === 'template-manifest' ? 'template manifest path is not available' : 'package manifest path is not available';
			return genericObservedState(input, manifestPath ? existsSync(manifestPath) : true, manifestPath ? [] : [warningLabel]);
		},
		diff(input) {
			const label = input.unit.unitType === 'template-manifest' ? 'template manifest' : 'package manifest';
			return input.observed.exists ? noopDiff() : { action: 'blocked', reasons: [`${label} is missing`], before: input.observed.live, after: input.unit.spec };
		},
		apply(input) {
			return genericResult(input);
		},
		verify(input) {
			return genericVerification(input, input.observed, input.unit.unitType === 'template-manifest'
				? 'Template manifest exists and is readable'
				: 'Package manifest exists and is readable');
		},
	};
}

export function buildPackageWorkflowAdapter(): TreeseedReconcileAdapter {
	return {
		providerId: 'github',
		unitTypes: ['package-workflow'],
		supports(unitType, providerId) {
			return unitType === 'package-workflow' && providerId === 'github';
		},
		refresh(input) {
			const packageId = typeof input.unit.spec.packageId === 'string'
				? input.unit.spec.packageId
				: typeof input.unit.metadata.packageId === 'string'
					? input.unit.metadata.packageId
					: null;
			const adapter = packageId ? findTreeseedPackageAdapter(input.context.tenantRoot, packageId) : null;
			const sync = packageId
				? syncTreeseedPackageWorkflows({ root: input.context.tenantRoot, packageId, execute: false })
				: [];
			return {
				...genericObservedState(input, Boolean(adapter), adapter ? [] : [`Package ${packageId ?? '(unknown)'} was not discovered.`]),
				status: sync.some((entry) => entry.changed || !entry.exists) ? 'drifted' : adapter ? 'ready' : 'error',
				live: {
					...input.unit.spec,
					packageId,
					workflows: sync,
				},
			};
		},
		diff(input) {
			if (!input.observed.exists) {
				return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			}
			const workflows = Array.isArray(input.observed.live.workflows) ? input.observed.live.workflows as Array<{ changed?: boolean; exists?: boolean }> : [];
			if (workflows.some((entry) => entry.changed || !entry.exists)) {
				return { action: 'update', reasons: ['package workflow files differ from rendered templates'], before: input.observed.live, after: input.unit.spec };
			}
			return noopDiff();
		},
		apply(input) {
			const packageId = typeof input.unit.spec.packageId === 'string'
				? input.unit.spec.packageId
				: typeof input.unit.metadata.packageId === 'string'
					? input.unit.metadata.packageId
					: null;
			if (packageId && input.context.planOnly !== true && input.diff.action !== 'noop') {
				const sync = syncTreeseedPackageWorkflows({
					root: input.context.tenantRoot,
					packageId,
					execute: true,
				});
				return genericResult(input, { ...input.observed.live, workflowSync: sync });
			}
			return genericResult(input);
		},
		verify(input) {
			const workflows = Array.isArray(input.observed.live.workflows) ? input.observed.live.workflows as Array<{ changed?: boolean; exists?: boolean; workflow?: string }> : [];
			const checks = workflows.map((workflow) => verificationCheck(
				`workflow:${workflow.workflow ?? 'unknown'}`,
				`Workflow ${workflow.workflow ?? 'unknown'} matches the rendered template`,
				'sdk',
				{
					exists: workflow.exists === true,
					configured: workflow.changed !== true,
					ready: workflow.exists === true && workflow.changed !== true,
					verified: workflow.exists === true && workflow.changed !== true,
					expected: 'rendered-template',
					observed: workflow,
					issues: [
						...(workflow.exists ? [] : ['workflow file is missing']),
						...(workflow.changed ? ['workflow file has template drift'] : []),
					],
				},
			));
			return summarizeVerification(input.unit.unitId, checks.length > 0 ? checks : [
				verificationCheck('package-workflow', 'Package workflow resource is observable', 'sdk', {
					exists: input.observed.exists,
					configured: input.observed.exists,
					ready: input.observed.exists,
					verified: input.observed.exists,
				}),
			], input.observed.warnings);
		},
	};
}
