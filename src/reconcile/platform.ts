export const TREESEED_RECONCILE_RUN_MODEL = [
	'refresh',
	'plan',
	'validate',
	'apply',
	'refresh',
	'verify',
	'persist',
] as const;

export const TREESEED_RECONCILE_ACTION_KINDS = [
	'noop',
	'create',
	'update',
	'replace',
	'delete',
	'adopt',
	'rename',
	'reattach',
	'retain',
	'taint',
	'blocked',
] as const;

export type TreeseedCanonicalReconcilePhase = typeof TREESEED_RECONCILE_RUN_MODEL[number];
export type TreeseedCanonicalReconcileActionKind = typeof TREESEED_RECONCILE_ACTION_KINDS[number];

export interface TreeseedCanonicalGraphNode {
	id: string;
	provider?: string | null;
	type?: string | null;
	owner?: string | null;
	environment?: string | null;
	spec?: unknown;
	state?: unknown;
	locators?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface TreeseedCanonicalDrift {
	id: string;
	resourceId?: string | null;
	severity?: 'info' | 'warning' | 'blocking';
	reason: string;
	expected?: unknown;
	observed?: unknown;
	provider?: string | null;
	type?: string | null;
}

export interface TreeseedCanonicalAction {
	id: string;
	kind: TreeseedCanonicalReconcileActionKind;
	resourceId: string;
	reason: string;
	provider?: string | null;
	type?: string | null;
	before?: unknown;
	after?: unknown;
}

export interface TreeseedCanonicalPostcondition {
	id: string;
	resourceId: string;
	description: string;
	source?: 'api' | 'cli' | 'sdk' | 'http' | 'local' | 'derived';
	required?: boolean;
	ok: boolean;
	issues: string[];
	expected?: unknown;
	observed?: unknown;
}

export interface TreeseedCanonicalLiveVerification {
	ok: boolean;
	source?: string;
	checkedAt?: string | null;
	issues: string[];
	checks?: unknown[];
}

export interface TreeseedCanonicalReconcileReport {
	desiredGraph: TreeseedCanonicalGraphNode[];
	observedGraph: TreeseedCanonicalGraphNode[];
	stateGraph: TreeseedCanonicalGraphNode[];
	diff: TreeseedCanonicalDrift[];
	actions: TreeseedCanonicalAction[];
	postconditions: TreeseedCanonicalPostcondition[];
	selectedResources: string[];
	skippedResources: Array<{ id: string; reason: string }>;
	blockedDrift: TreeseedCanonicalDrift[];
	providerLimitations: TreeseedCanonicalDrift[];
	retainedResources: TreeseedCanonicalGraphNode[];
	destroyedResources: TreeseedCanonicalGraphNode[];
	liveVerification: TreeseedCanonicalLiveVerification;
	ok: boolean;
}

export interface CreateTreeseedCanonicalReconcileReportInput {
	desiredGraph?: TreeseedCanonicalGraphNode[];
	observedGraph?: TreeseedCanonicalGraphNode[];
	stateGraph?: TreeseedCanonicalGraphNode[];
	diff?: TreeseedCanonicalDrift[];
	actions?: TreeseedCanonicalAction[];
	postconditions?: TreeseedCanonicalPostcondition[];
	selectedResources?: string[];
	skippedResources?: Array<{ id: string; reason: string }>;
	blockedDrift?: TreeseedCanonicalDrift[];
	providerLimitations?: TreeseedCanonicalDrift[];
	retainedResources?: TreeseedCanonicalGraphNode[];
	destroyedResources?: TreeseedCanonicalGraphNode[];
	liveVerification?: Partial<TreeseedCanonicalLiveVerification>;
}

function hasBlockingAction(actions: TreeseedCanonicalAction[]) {
	return actions.some((action) => action.kind === 'blocked');
}

function liveVerificationOk(input: Partial<TreeseedCanonicalLiveVerification> | undefined, postconditions: TreeseedCanonicalPostcondition[]) {
	if (input?.ok === false) return false;
	if ((input?.issues ?? []).length > 0) return false;
	return postconditions.every((postcondition) => postcondition.required === false || postcondition.ok);
}

export function createTreeseedCanonicalReconcileReport(
	input: CreateTreeseedCanonicalReconcileReportInput = {},
): TreeseedCanonicalReconcileReport {
	const desiredGraph = input.desiredGraph ?? [];
	const observedGraph = input.observedGraph ?? [];
	const stateGraph = input.stateGraph ?? [];
	const diff = input.diff ?? [];
	const actions = input.actions ?? [];
	const postconditions = input.postconditions ?? [];
	const selectedResources = input.selectedResources ?? desiredGraph.map((node) => node.id);
	const skippedResources = input.skippedResources ?? [];
	const blockedDrift = input.blockedDrift ?? diff.filter((entry) => entry.severity === 'blocking');
	const providerLimitations = input.providerLimitations ?? [];
	const retainedResources = input.retainedResources ?? [];
	const destroyedResources = input.destroyedResources ?? [];
	const liveVerification: TreeseedCanonicalLiveVerification = {
		ok: input.liveVerification?.ok ?? liveVerificationOk(input.liveVerification, postconditions),
		source: input.liveVerification?.source ?? 'sdk',
		checkedAt: input.liveVerification?.checkedAt ?? null,
		issues: input.liveVerification?.issues ?? [],
		checks: input.liveVerification?.checks ?? [],
	};
	const ok = liveVerification.ok
		&& blockedDrift.length === 0
		&& providerLimitations.length === 0
		&& !hasBlockingAction(actions)
		&& postconditions.every((postcondition) => postcondition.required === false || postcondition.ok);
	return {
		desiredGraph,
		observedGraph,
		stateGraph,
		diff,
		actions,
		postconditions,
		selectedResources,
		skippedResources,
		blockedDrift,
		providerLimitations,
		retainedResources,
		destroyedResources,
		liveVerification,
		ok,
	};
}

export function assertTreeseedCanonicalReconcileSuccess(report: TreeseedCanonicalReconcileReport): void {
	if (report.ok) return;
	const reasons = [
		...report.blockedDrift.map((entry) => `blocked drift ${entry.id}: ${entry.reason}`),
		...report.providerLimitations.map((entry) => `provider limitation ${entry.id}: ${entry.reason}`),
		...report.actions.filter((action) => action.kind === 'blocked').map((action) => `blocked action ${action.id}: ${action.reason}`),
		...report.postconditions
			.filter((postcondition) => postcondition.required !== false && !postcondition.ok)
			.map((postcondition) => `postcondition ${postcondition.id}: ${postcondition.issues.join('; ') || 'failed'}`),
		...report.liveVerification.issues.map((issue) => `live verification: ${issue}`),
	];
	throw new Error(`Treeseed reconciliation did not converge: ${reasons.join(' | ') || 'unknown drift remained'}`);
}

export function summarizeTreeseedCanonicalReconcileReport(report: TreeseedCanonicalReconcileReport) {
	return {
		ok: report.ok,
		desired: report.desiredGraph.length,
		observed: report.observedGraph.length,
		actions: report.actions.length,
		postconditions: report.postconditions.length,
		blockedDrift: report.blockedDrift.length,
		providerLimitations: report.providerLimitations.length,
		retainedResources: report.retainedResources.length,
		destroyedResources: report.destroyedResources.length,
		liveVerificationOk: report.liveVerification.ok,
	};
}
