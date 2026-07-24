export const RECONCILE_RUN_MODEL = [
	'refresh',
	'plan',
	'validate',
	'apply',
	'refresh',
	'verify',
	'persist',
] as const;

export const RECONCILE_ACTION_KINDS = [
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

export type CanonicalReconcilePhase = typeof RECONCILE_RUN_MODEL[number];
export type CanonicalReconcileActionKind = typeof RECONCILE_ACTION_KINDS[number];

export interface CanonicalGraphNode {
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

export interface CanonicalDrift {
	id: string;
	resourceId?: string | null;
	severity?: 'info' | 'warning' | 'blocking';
	reason: string;
	expected?: unknown;
	observed?: unknown;
	provider?: string | null;
	type?: string | null;
}

export interface CanonicalAction {
	id: string;
	kind: CanonicalReconcileActionKind;
	resourceId: string;
	reason: string;
	provider?: string | null;
	type?: string | null;
	before?: unknown;
	after?: unknown;
}

export interface CanonicalPostcondition {
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

export interface CanonicalLiveVerification {
	ok: boolean;
	source?: string;
	checkedAt?: string | null;
	issues: string[];
	checks?: unknown[];
}

export interface CanonicalReconcileReport {
	desiredGraph: CanonicalGraphNode[];
	observedGraph: CanonicalGraphNode[];
	stateGraph: CanonicalGraphNode[];
	diff: CanonicalDrift[];
	actions: CanonicalAction[];
	postconditions: CanonicalPostcondition[];
	selectedResources: string[];
	skippedResources: Array<{ id: string; reason: string }>;
	blockedDrift: CanonicalDrift[];
	providerLimitations: CanonicalDrift[];
	retainedResources: CanonicalGraphNode[];
	destroyedResources: CanonicalGraphNode[];
	liveVerification: CanonicalLiveVerification;
	ok: boolean;
}

export interface CreateCanonicalReconcileReportInput {
	desiredGraph?: CanonicalGraphNode[];
	observedGraph?: CanonicalGraphNode[];
	stateGraph?: CanonicalGraphNode[];
	diff?: CanonicalDrift[];
	actions?: CanonicalAction[];
	postconditions?: CanonicalPostcondition[];
	selectedResources?: string[];
	skippedResources?: Array<{ id: string; reason: string }>;
	blockedDrift?: CanonicalDrift[];
	providerLimitations?: CanonicalDrift[];
	retainedResources?: CanonicalGraphNode[];
	destroyedResources?: CanonicalGraphNode[];
	liveVerification?: Partial<CanonicalLiveVerification>;
}

function hasBlockingAction(actions: CanonicalAction[]) {
	return actions.some((action) => action.kind === 'blocked');
}

function liveVerificationOk(input: Partial<CanonicalLiveVerification> | undefined, postconditions: CanonicalPostcondition[]) {
	if (input?.ok === false) return false;
	if ((input?.issues ?? []).length > 0) return false;
	return postconditions.every((postcondition) => postcondition.required === false || postcondition.ok);
}

export function createCanonicalReconcileReport(
	input: CreateCanonicalReconcileReportInput = {},
): CanonicalReconcileReport {
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
	const liveVerification: CanonicalLiveVerification = {
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

export function assertCanonicalReconcileSuccess(report: CanonicalReconcileReport): void {
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

export function summarizeCanonicalReconcileReport(report: CanonicalReconcileReport) {
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
