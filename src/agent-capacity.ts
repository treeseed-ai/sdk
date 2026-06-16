import type {
	CapacityGrant,
	CapacityPlan as LegacyCapacityPlan,
	CapacityProvider,
	CapacityReservation,
	ExecutionProvider,
	TaskUsageActual,
} from './sdk-types.ts';

export type AgentExecutionMode = 'planning' | 'acting';
export type AllocationSetStatus = 'draft' | 'active' | 'superseded' | 'archived';
export type ProjectAgentClassStatus = 'active' | 'paused' | 'archived';
export type ProviderAvailabilitySessionStatus = 'open' | 'draining' | 'closed' | 'expired';
export type ProviderAssignmentStatus = 'pending' | 'leased' | 'running' | 'completed' | 'failed' | 'returned' | 'expired';
export type ProviderAssignmentLeaseState = 'unleased' | 'leased' | 'released' | 'expired';
export type AgentModeRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AgentKernelModeExecutionStatus = 'completed' | 'waiting' | 'failed' | 'returned';
export type DecisionExecutionReadinessStatus = 'draft' | 'blocked' | 'ready' | 'stale' | 'waived';
export type PlanningInputRequestStatus = 'requested' | 'complete' | 'waived' | 'rejected' | 'stale';
export type DecisionExecutionInputStatus = 'proposed' | 'accepted' | 'revision_requested' | 'rejected' | 'stale';
export type WorkdayCapacityEnvelopeStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
export type DurableAgentCapacityPlanStatus = 'draft' | 'accepted' | 'revision_requested' | 'deferred' | 'scheduled' | 'active' | 'completed' | 'superseded';
export type ProviderAssignmentSynthesisSource =
	| 'approved_decision'
	| 'planning_input_request'
	| 'capacity_plan'
	| 'verification_failure'
	| 'fallback_queue'
	| 'fixture';
export type AgentKernelModeFallbackCode =
	| 'assignment_missing_project_or_agent'
	| 'assignment_lease_expired'
	| 'assignment_mode_not_allowed'
	| 'assignment_missing_capacity_envelope'
	| 'assignment_missing_decision_input'
	| 'assignment_handler_failed'
	| 'assignment_project_not_synced'
	| 'assignment_agent_not_found'
	| 'assignment_insufficient_capability'
	| 'assignment_decision_not_ready'
	| 'assignment_treedx_proxy_scope_invalid'
	| 'assignment_fallback_quota_exceeded';

export interface AllocationSetSlice {
	projectId: string | null;
	capacityProviderId: string;
	laneId?: string | null;
	environment?: string | null;
	priorityWeight?: number | null;
	overflowPolicy?: string | null;
	percent?: number | null;
	dailyCreditLimit?: number | null;
	monthlyCreditLimit?: number | null;
	metadata?: Record<string, unknown>;
}

export interface AllocationSet {
	id: string;
	teamId: string;
	version: string;
	status: AllocationSetStatus | string;
	effectiveFrom?: string | null;
	effectiveUntil?: string | null;
	policy: Record<string, unknown>;
	slices: AllocationSetSlice[];
	createdById?: string | null;
	activatedAt?: string | null;
	supersededById?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export type CapacityAllocationSet = AllocationSet;

export interface AgentKernelProfile {
	id?: string;
	name?: string;
	defaultMode?: AgentExecutionMode;
	allowedModes?: AgentExecutionMode[];
	planningBudgetPercent?: number;
	actingBudgetPercent?: number;
	maxConcurrentModeRuns?: number;
	fallbackMode?: AgentExecutionMode | null;
	metadata?: Record<string, unknown>;
}

export interface AgentKernelPolicy {
	modeSelection?: Record<string, unknown>;
	budgetSplit?: Record<string, unknown>;
	fallback?: Record<string, unknown>;
	outputValidation?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface ProjectAgentClass {
	id: string;
	teamId: string;
	projectId: string;
	slug: string;
	name: string;
	status: ProjectAgentClassStatus | string;
	allowedModes: AgentExecutionMode[];
	requiredCapabilities: string[];
	kernelProfile: AgentKernelProfile;
	kernelPolicy: AgentKernelPolicy;
	handlerRefs: Record<string, unknown>;
	outputContracts: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface WorkdayCapacityEnvelope {
	teamId: string;
	projectId: string;
	workDayId?: string | null;
	environment?: string | null;
	allocationSetId?: string | null;
	availableCredits?: number | null;
	reservedCredits?: number | null;
	consumedCredits?: number | null;
	metadata?: Record<string, unknown>;
}

export interface AgentCapacityEnvelope extends WorkdayCapacityEnvelope {
	mode: AgentExecutionMode;
	projectAgentClassId?: string | null;
	capacityProviderId?: string | null;
	executionProviderId?: string | null;
	laneId?: string | null;
	reservationId?: string | null;
	nativeUnit?: string | null;
	reservedNativeAmount?: number | null;
	limits?: Record<string, unknown>;
}

export interface DecisionExecutionInput {
	teamId: string;
	projectId: string;
	projectAgentClassId: string;
	mode: AgentExecutionMode;
	taskId?: string | null;
	workDayId?: string | null;
	agentId?: string | null;
	handlerId?: string | null;
	capacity: AgentCapacityEnvelope;
	input: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface AgentCapacityPlan {
	teamId: string;
	projectId: string;
	environment: string;
	allocationSetId?: string | null;
	workday: WorkdayCapacityEnvelope;
	assignableProviders: Array<{
		capacityProviderId: string;
		executionProviderId?: string | null;
		laneId?: string | null;
		availableCredits?: number | null;
		reasons?: string[];
		metadata?: Record<string, unknown>;
	}>;
	legacyPlan?: LegacyCapacityPlan | Record<string, unknown> | null;
	metadata?: Record<string, unknown>;
}

export type CapacityPlan = AgentCapacityPlan;

export interface ProviderAvailabilitySession {
	id: string;
	teamId: string;
	capacityProviderId: string;
	registrationId?: string | null;
	environment?: string | null;
	status: ProviderAvailabilitySessionStatus | string;
	checkedInAt: string;
	availableFrom?: string | null;
	availableUntil?: string | null;
	executionProviders: ExecutionProvider[];
	capabilities: string[];
	grants: CapacityGrant[];
	nativeLimits?: Record<string, unknown>;
	runnerPressure?: Record<string, unknown>;
	constraints?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
	closedAt?: string | null;
}

export interface ProviderAssignment {
	id: string;
	teamId: string;
	projectId: string;
	capacityProviderId: string;
	providerSessionId?: string | null;
	executionProviderId?: string | null;
	allocationSetId?: string | null;
	projectAgentClassId: string;
	reservationId?: string | null;
	workDayId?: string | null;
	taskId?: string | null;
	mode: AgentExecutionMode;
	status: ProviderAssignmentStatus | string;
	leaseState: ProviderAssignmentLeaseState | string;
	leaseExpiresAt?: string | null;
	leaseToken?: string | null;
	leaseRenewedAt?: string | null;
	runnerId?: string | null;
	agentId?: string | null;
	handlerId?: string | null;
	capacityEnvelope: AgentCapacityEnvelope;
	decisionInput: DecisionExecutionInput | Record<string, unknown>;
	workspaceContext?: Record<string, unknown>;
	allowedOutputs?: Record<string, unknown>;
	explanation?: Record<string, unknown>;
	attemptCount?: number;
	assignedAt?: string | null;
	claimedAt?: string | null;
	completedAt?: string | null;
	returnedAt?: string | null;
	failedAt?: string | null;
	lifecycleReason?: string | null;
	lifecycleCode?: string | null;
	lifecycleOutput?: Record<string, unknown>;
	synthesizedFrom?: ProviderAssignmentSynthesisSource | string | null;
	synthesisKey?: string | null;
	decisionId?: string | null;
	proposalId?: string | null;
	fallbackOutputId?: string | null;
	treedxProxyHandle?: TreeDxProxyHandle | Record<string, unknown> | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface ProviderAssignmentLifecycleRequest {
	runnerId?: string | null;
	leaseToken?: string | null;
	leaseSeconds?: number | null;
	reason?: string | null;
	code?: string | null;
	message?: string | null;
	retryable?: boolean | null;
	output?: Record<string, unknown> | null;
	summary?: Record<string, unknown> | null;
	usageActualId?: string | null;
	modeRunId?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ProviderCheckInRequest {
	id?: string;
	registrationId?: string | null;
	environment?: string | null;
	status?: ProviderAvailabilitySessionStatus | string;
	availableFrom?: string | null;
	availableUntil?: string | null;
	executionProviders?: ExecutionProvider[];
	capabilities?: string[];
	grants?: CapacityGrant[];
	nativeLimits?: Record<string, unknown>;
	runnerPressure?: Record<string, unknown>;
	constraints?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface ProviderNextAssignmentRequest {
	sessionId?: string | null;
	runnerId?: string | null;
	leaseSeconds?: number | null;
	capabilities?: string[];
	metadata?: Record<string, unknown>;
}

export interface ProviderAssignmentLifecycleResult {
	ok: true;
	payload: ProviderAssignment | null;
	assignment?: ProviderAssignment | null;
	leaseToken?: string | null;
	leaseSeconds?: number | null;
}

export interface AgentModeRunUsageSettlement {
	taskUsageActualId?: string | null;
	capacityLedgerEntryId?: string | null;
	actualCredits?: number | null;
	actualUsd?: number | null;
	nativeUsage?: Record<string, unknown> | null;
	metadata?: Record<string, unknown>;
}

export interface AgentModeRun {
	id: string;
	teamId: string;
	projectId: string;
	providerAssignmentId: string;
	capacityProviderId: string;
	executionProviderId?: string | null;
	projectAgentClassId: string;
	agentId?: string | null;
	handlerId?: string | null;
	mode: AgentExecutionMode;
	status: AgentModeRunStatus | string;
	selectedInput: Record<string, unknown>;
	capacityEnvelope: AgentCapacityEnvelope;
	outputs?: Record<string, unknown>;
	traceRefs?: Record<string, unknown>;
	usageActual?: AgentModeRunUsageSettlement | Record<string, unknown>;
	validation?: Record<string, unknown>;
	fallbackReason?: string | null;
	startedAt?: string | null;
	completedAt?: string | null;
	failedAt?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface AgentKernelModeFallback {
	code: AgentKernelModeFallbackCode | string;
	reason: string;
	retryable: boolean;
	metadata?: Record<string, unknown>;
}

export interface AgentKernelModeExecutionInput {
	assignment: ProviderAssignment;
	projectAgentClass?: ProjectAgentClass | null;
	kernelProfile?: AgentKernelProfile | null;
	kernelPolicy?: AgentKernelPolicy | null;
	capacityEnvelope?: AgentCapacityEnvelope | null;
	decisionInput?: DecisionExecutionInput | null;
	leaseToken?: string | null;
	runnerId?: string | null;
	readiness?: DecisionPlanningStatus | null;
	treedxProxyHandle?: TreeDxProxyHandle | null;
	now?: string | Date;
	metadata?: Record<string, unknown>;
}

export interface AgentKernelModeExecutionResult {
	status: AgentKernelModeExecutionStatus;
	mode: AgentExecutionMode;
	assignmentId: string;
	projectId: string;
	projectAgentClassId: string;
	agentId?: string | null;
	handlerId?: string | null;
	summary: string;
	outputs?: Record<string, unknown>;
	selectedInput: Record<string, unknown>;
	capacityEnvelope: AgentCapacityEnvelope;
	traceRefs?: Record<string, unknown>;
	usageActual?: AgentModeRunUsageSettlement | Record<string, unknown> | null;
	fallback?: AgentKernelModeFallback | null;
	metadata?: Record<string, unknown>;
}

export interface DecisionPlanningStatus {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	humanApprovalState?: string | null;
	executionReadiness: DecisionExecutionReadinessStatus | string;
	planningInputsStatus: PlanningInputRequestStatus | string;
	scopeHash: string;
	staleReason?: string | null;
	readyAt?: string | null;
	staleAt?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface PlanningInputRequest {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	projectAgentClassId?: string | null;
	mode: AgentExecutionMode;
	status: PlanningInputRequestStatus | string;
	scopeHash: string;
	prompt?: string | null;
	response?: Record<string, unknown> | null;
	metadata?: Record<string, unknown>;
	requestedAt?: string;
	completedAt?: string | null;
	staleAt?: string | null;
}

export interface DecisionExecutionInputRecord {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	projectAgentClassId: string;
	mode: AgentExecutionMode;
	status: DecisionExecutionInputStatus | string;
	scopeHash: string;
	input: DecisionExecutionInput;
	acceptedAt?: string | null;
	revisionRequestedAt?: string | null;
	staleAt?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface WorkdayCapacityEnvelopeRecord {
	id: string;
	teamId: string;
	projectId: string;
	allocationSetId?: string | null;
	status: WorkdayCapacityEnvelopeStatus | string;
	startedAt?: string | null;
	pausedAt?: string | null;
	completedAt?: string | null;
	envelope: WorkdayCapacityEnvelope;
	modeSplits: Record<string, unknown>;
	caps: Record<string, unknown>;
	reserves: Record<string, unknown>;
	borrowingRules: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface AgentCapacityPlanWorkUnit {
	id: string;
	decisionExecutionInputId: string;
	decisionId: string;
	projectAgentClassId: string;
	mode: AgentExecutionMode;
	taskId?: string | null;
	agentId?: string | null;
	handlerId?: string | null;
	workDayId?: string | null;
	expectedCredits: number;
	highCredits: number;
	requiredCapabilities: string[];
	dependencies: string[];
	blockers: string[];
	risk: Record<string, unknown>;
	assumptions: string[];
	confidence?: number | null;
	capacityEnvelope: AgentCapacityEnvelope;
	decisionInput: DecisionExecutionInput;
	metadata?: Record<string, unknown>;
}

export interface AgentCapacityPlanRecord {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	status: DurableAgentCapacityPlanStatus | string;
	scopeHash: string;
	allocationSetId?: string | null;
	workDayId?: string | null;
	expectedCredits: number;
	highCredits: number;
	workUnits: AgentCapacityPlanWorkUnit[];
	capabilityNeeds: string[];
	environmentNeeds: string[];
	reserves: Record<string, unknown>;
	blockers: string[];
	priorityRationale?: string | null;
	metadata?: Record<string, unknown>;
	acceptedAt?: string | null;
	scheduledAt?: string | null;
	createdAt?: string;
	updatedAt?: string;
}

export interface ProviderAssignmentSynthesisCandidate {
	id?: string;
	teamId: string;
	projectId: string;
	capacityProviderId: string;
	executionProviderId?: string | null;
	projectAgentClassId: string;
	mode: AgentExecutionMode;
	source: ProviderAssignmentSynthesisSource | string;
	sourceId: string;
	synthesisKey: string;
	priority?: number | null;
	readiness?: DecisionPlanningStatus | null;
	capacityEnvelope: AgentCapacityEnvelope;
	decisionInput: DecisionExecutionInput;
	workspaceContext?: Record<string, unknown>;
	explanation?: ProviderAssignmentExplanation | Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface ProviderAssignmentExplanation {
	id?: string;
	teamId: string;
	assignmentId: string;
	source: ProviderAssignmentSynthesisSource | string;
	sourceId?: string | null;
	eligible: boolean;
	reasons: string[];
	gates: Record<string, unknown>;
	allocationPolicyVersion?: string | null;
	grantScope?: string | null;
	createdAt?: string;
	metadata?: Record<string, unknown>;
}

export interface TreeDxProxyHandle {
	id: string;
	teamId: string;
	projectId: string;
	assignmentId?: string | null;
	repositoryId?: string | null;
	workspaceId?: string | null;
	scopes: string[];
	expiresAt?: string | null;
	auditId?: string | null;
	metadata?: Record<string, unknown>;
}

export interface AgentFallbackOutput {
	id: string;
	teamId: string;
	projectId: string;
	assignmentId?: string | null;
	mode: AgentExecutionMode;
	code: AgentKernelModeFallbackCode | string;
	status: 'draft' | 'emitted' | 'suppressed' | 'duplicate' | 'quota_exceeded' | string;
	output: Record<string, unknown>;
	provenance: Record<string, unknown>;
	quota: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt?: string;
}

export interface CapacitySettlementSummary {
	id?: string;
	teamId: string;
	projectId?: string | null;
	workDayId?: string | null;
	allocationSetId?: string | null;
	policyVersion?: string | null;
	reservedCredits: number;
	consumedCredits: number;
	releasedCredits: number;
	refundedCredits: number;
	nativeUsage: Record<string, unknown>;
	providerConfidence: 'high' | 'medium' | 'low' | 'blocked' | string;
	warnings: string[];
	metadata?: Record<string, unknown>;
	createdAt?: string;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOrNull(value: unknown): number | null {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
	return `{${entries.join(',')}}`;
}

export function computeDecisionScopeHash(scope: unknown): string {
	const text = stableStringify(scope ?? {});
	let hash = 5381;
	for (let index = 0; index < text.length; index += 1) {
		hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
	}
	return `scope_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function isDecisionReadyForActing(status?: Pick<DecisionPlanningStatus, 'executionReadiness' | 'planningInputsStatus'> | null): boolean {
	if (!status) return false;
	const readiness = status.executionReadiness;
	const planning = status.planningInputsStatus;
	return (readiness === 'ready' || readiness === 'waived') && (planning === 'complete' || planning === 'waived');
}

export function isPlanningInputOpen(request: Pick<PlanningInputRequest, 'status'>): boolean {
	return request.status === 'requested' || request.status === 'stale';
}

export function isDecisionExecutionInputAccepted(input: Pick<DecisionExecutionInputRecord, 'status'>): boolean {
	return input.status === 'accepted';
}

export function isAgentCapacityPlanAccepted(plan?: Pick<AgentCapacityPlanRecord, 'status'> | null): boolean {
	return Boolean(plan && ['accepted', 'scheduled', 'active'].includes(String(plan.status)));
}

export function normalizeDecisionExecutionEstimate(input: DecisionExecutionInputRecord | DecisionExecutionInput): {
	expectedCredits: number;
	highCredits: number;
	requiredCapabilities: string[];
	dependencies: string[];
	blockers: string[];
	assumptions: string[];
	confidence: number | null;
	environmentNeeds: string[];
	risk: Record<string, unknown>;
} {
	const source = 'input' in input && input.input && 'input' in input.input
		? input.input.input
		: record((input as DecisionExecutionInput).input);
	const metadata = record((input as DecisionExecutionInputRecord).metadata ?? (input as DecisionExecutionInput).metadata);
	const estimate = record(source.estimate ?? metadata.estimate);
	const capabilities = Array.isArray(source.requiredCapabilities)
		? source.requiredCapabilities
		: Array.isArray(metadata.requiredCapabilities)
			? metadata.requiredCapabilities
			: [];
	const dependencies = Array.isArray(source.dependencies) ? source.dependencies : Array.isArray(metadata.dependencies) ? metadata.dependencies : [];
	const blockers = Array.isArray(source.blockers) ? source.blockers : Array.isArray(metadata.blockers) ? metadata.blockers : [];
	const assumptions = Array.isArray(source.assumptions) ? source.assumptions : Array.isArray(metadata.assumptions) ? metadata.assumptions : [];
	const environmentNeeds = Array.isArray(source.environmentNeeds) ? source.environmentNeeds : Array.isArray(metadata.environmentNeeds) ? metadata.environmentNeeds : [];
	const expectedCredits = numberOrNull(estimate.expectedCredits ?? estimate.credits ?? source.expectedCredits ?? metadata.expectedCredits) ?? 1;
	const highCredits = Math.max(expectedCredits, numberOrNull(estimate.highCredits ?? estimate.p90Credits ?? source.highCredits ?? metadata.highCredits) ?? expectedCredits);
	const confidence = numberOrNull(estimate.confidence ?? source.confidence ?? metadata.confidence);
	return {
		expectedCredits,
		highCredits,
		requiredCapabilities: capabilities.map(String).filter(Boolean),
		dependencies: dependencies.map(String).filter(Boolean),
		blockers: blockers.map(String).filter(Boolean),
		assumptions: assumptions.map(String).filter(Boolean),
		confidence,
		environmentNeeds: environmentNeeds.map(String).filter(Boolean),
		risk: record(source.risk ?? metadata.risk),
	};
}

export function buildAgentCapacityPlanDraft(input: {
	id: string;
	teamId: string;
	projectId: string;
	decisionId: string;
	scopeHash: string;
	executionInputs: DecisionExecutionInputRecord[];
	allocationSetId?: string | null;
	workDayId?: string | null;
	status?: DurableAgentCapacityPlanStatus | string;
	metadata?: Record<string, unknown>;
	now?: string;
}): AgentCapacityPlanRecord {
	const timestamp = input.now ?? new Date().toISOString();
	const accepted = input.executionInputs.filter(isDecisionExecutionInputAccepted);
	const workUnits = accepted.map((entry, index): AgentCapacityPlanWorkUnit => {
		const estimate = normalizeDecisionExecutionEstimate(entry);
		const decisionInput = entry.input;
		const capacityEnvelope = {
			...decisionInput.capacity,
			teamId: input.teamId,
			projectId: input.projectId,
			workDayId: decisionInput.capacity?.workDayId ?? input.workDayId ?? null,
			allocationSetId: decisionInput.capacity?.allocationSetId ?? input.allocationSetId ?? null,
			mode: normalizeAgentExecutionMode(decisionInput.mode, 'acting'),
			projectAgentClassId: entry.projectAgentClassId,
			metadata: {
				...(decisionInput.capacity?.metadata ?? {}),
				capacityPlanId: input.id,
				decisionExecutionInputId: entry.id,
			},
		};
		return {
			id: `${input.id}:wu:${index + 1}`,
			decisionExecutionInputId: entry.id,
			decisionId: input.decisionId,
			projectAgentClassId: entry.projectAgentClassId,
			mode: normalizeAgentExecutionMode(entry.mode, 'acting'),
			taskId: decisionInput.taskId ?? null,
			agentId: decisionInput.agentId ?? null,
			handlerId: decisionInput.handlerId ?? null,
			workDayId: capacityEnvelope.workDayId ?? null,
			expectedCredits: estimate.expectedCredits,
			highCredits: estimate.highCredits,
			requiredCapabilities: estimate.requiredCapabilities,
			dependencies: estimate.dependencies,
			blockers: estimate.blockers,
			risk: estimate.risk,
			assumptions: estimate.assumptions,
			confidence: estimate.confidence,
			capacityEnvelope,
			decisionInput: {
				...decisionInput,
				capacity: capacityEnvelope,
				metadata: {
					...(decisionInput.metadata ?? {}),
					capacityPlanId: input.id,
					decisionExecutionInputId: entry.id,
				},
			},
			metadata: entry.metadata ?? {},
		};
	});
	const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
	return {
		id: input.id,
		teamId: input.teamId,
		projectId: input.projectId,
		decisionId: input.decisionId,
		status: input.status ?? 'draft',
		scopeHash: input.scopeHash,
		allocationSetId: input.allocationSetId ?? null,
		workDayId: input.workDayId ?? null,
		expectedCredits: workUnits.reduce((sum, unit) => sum + unit.expectedCredits, 0),
		highCredits: workUnits.reduce((sum, unit) => sum + unit.highCredits, 0),
		workUnits,
		capabilityNeeds: unique(workUnits.flatMap((unit) => unit.requiredCapabilities)),
		environmentNeeds: unique(accepted.flatMap((entry) => normalizeDecisionExecutionEstimate(entry).environmentNeeds)),
		reserves: { highCredits: workUnits.reduce((sum, unit) => sum + unit.highCredits, 0) },
		blockers: unique(workUnits.flatMap((unit) => unit.blockers)),
		priorityRationale: typeof input.metadata?.priorityRationale === 'string' ? input.metadata.priorityRationale : null,
		metadata: input.metadata ?? {},
		acceptedAt: null,
		scheduledAt: null,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

export function isProviderAssignmentCandidateEligible(candidate: ProviderAssignmentSynthesisCandidate): boolean {
	if (!candidate.teamId || !candidate.projectId || !candidate.capacityProviderId || !candidate.projectAgentClassId) return false;
	if (candidate.mode === 'acting' && candidate.readiness && !isDecisionReadyForActing(candidate.readiness)) return false;
	return candidate.capacityEnvelope.mode === candidate.mode && candidate.decisionInput.mode === candidate.mode;
}

export function validateTreeDxProxyHandle(handle: TreeDxProxyHandle | null | undefined, expected: { teamId?: string | null; projectId: string; assignmentId?: string | null }): AgentKernelModeFallback | null {
	if (!handle) return null;
	if (!handle.id && !handle.projectId) return null;
	if (handle.projectId !== expected.projectId || (expected.teamId && handle.teamId !== expected.teamId)) {
		return createAgentKernelModeFallback(
			'assignment_treedx_proxy_scope_invalid',
			'TreeDX proxy handle scope does not match the assignment project.',
			{ retryable: false },
		);
	}
	if (expected.assignmentId && handle.assignmentId && handle.assignmentId !== expected.assignmentId) {
		return createAgentKernelModeFallback(
			'assignment_treedx_proxy_scope_invalid',
			'TreeDX proxy handle is bound to a different assignment.',
			{ retryable: false },
		);
	}
	if (handle.expiresAt && Date.parse(handle.expiresAt) <= Date.now()) {
		return createAgentKernelModeFallback(
			'assignment_treedx_proxy_scope_invalid',
			'TreeDX proxy handle expired before assignment execution.',
			{ retryable: true },
		);
	}
	return null;
}

export function buildProviderAssignmentExplanation(input: {
	source: ProviderAssignmentSynthesisSource | string;
	sourceId?: string | null;
	eligible: boolean;
	reasons?: string[];
	gates?: Record<string, unknown>;
	allocationPolicyVersion?: string | null;
	grantScope?: string | null;
	metadata?: Record<string, unknown>;
}): ProviderAssignmentExplanation {
	return {
		teamId: '',
		assignmentId: '',
		source: input.source,
		sourceId: input.sourceId ?? null,
		eligible: input.eligible,
		reasons: input.reasons ?? [],
		gates: input.gates ?? {},
		allocationPolicyVersion: input.allocationPolicyVersion ?? null,
		grantScope: input.grantScope ?? null,
		metadata: input.metadata ?? {},
	};
}

export function evaluateFallbackQuota(input: { existingCount?: number | null; quota?: number | null }): AgentKernelModeFallback | null {
	const quota = Number(input.quota);
	if (!Number.isFinite(quota) || quota < 0) return null;
	const existing = Number(input.existingCount ?? 0);
	if (existing < quota) return null;
	return createAgentKernelModeFallback(
		'assignment_fallback_quota_exceeded',
		'Fallback output quota is exhausted for this project scope.',
		{ retryable: true, metadata: { quota, existingCount: existing } },
	);
}

export function deriveAllocationSetFromCapacityGrants(input: {
	id: string;
	teamId: string;
	version?: string;
	status?: AllocationSetStatus | string;
	grants: CapacityGrant[];
	createdById?: string | null;
	now?: string;
	metadata?: Record<string, unknown>;
}): AllocationSet {
	const timestamp = input.now ?? new Date().toISOString();
	return {
		id: input.id,
		teamId: input.teamId,
		version: input.version ?? timestamp,
		status: input.status ?? 'draft',
		effectiveFrom: null,
		effectiveUntil: null,
		policy: {
			source: 'capacity_grants',
			grantCount: input.grants.length,
		},
		slices: input.grants.map((grant) => ({
			projectId: grant.projectId,
			capacityProviderId: grant.capacityProviderId,
			laneId: grant.laneId,
			environment: grant.environment,
			priorityWeight: grant.priorityWeight,
			overflowPolicy: grant.overflowPolicy,
			percent: grant.portfolioAllocationPercent ?? null,
			dailyCreditLimit: grant.dailyCreditLimit,
			monthlyCreditLimit: grant.monthlyCreditLimit,
			metadata: grant.metadata ?? {},
		})),
		createdById: input.createdById ?? null,
		activatedAt: null,
		supersededById: null,
		metadata: input.metadata ?? {},
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

export function deriveProviderAvailabilitySession(input: {
	id: string;
	provider: CapacityProvider;
	registrationId?: string | null;
	environment?: string | null;
	executionProviders?: ExecutionProvider[];
	grants?: CapacityGrant[];
	runnerPressure?: Record<string, unknown>;
	constraints?: Record<string, unknown>;
	now?: string;
	metadata?: Record<string, unknown>;
}): ProviderAvailabilitySession {
	const timestamp = input.now ?? new Date().toISOString();
	return {
		id: input.id,
		teamId: input.provider.teamId ?? input.provider.ownerTeamId ?? '',
		capacityProviderId: input.provider.id,
		registrationId: input.registrationId ?? null,
		environment: input.environment ?? null,
		status: input.provider.status === 'draining' ? 'draining' : 'open',
		checkedInAt: timestamp,
		availableFrom: timestamp,
		availableUntil: null,
		executionProviders: input.executionProviders ?? [],
		capabilities: Array.isArray(input.provider.capabilities) ? input.provider.capabilities.map(String) : [],
		grants: input.grants ?? [],
		nativeLimits: record(input.provider.metadata?.nativeLimits),
		runnerPressure: input.runnerPressure ?? record(input.provider.metadata?.lastHealth),
		constraints: input.constraints ?? {},
		metadata: input.metadata ?? {},
		createdAt: timestamp,
		updatedAt: timestamp,
		closedAt: null,
	};
}

export function deriveAgentCapacityPlanFromCapacityPlan(plan: LegacyCapacityPlan | Record<string, unknown>): AgentCapacityPlan {
	const raw = record(plan);
	const project = record(raw.project);
	const capacity = record(raw.capacity ?? raw.summary);
	const providers = Array.isArray(raw.providers) ? raw.providers : [];
	return {
		teamId: String(raw.teamId ?? project.teamId ?? ''),
		projectId: String(raw.projectId ?? project.id ?? ''),
		environment: String(raw.environment ?? 'staging'),
		allocationSetId: typeof raw.allocationSetId === 'string' ? raw.allocationSetId : null,
		workday: {
			teamId: String(raw.teamId ?? project.teamId ?? ''),
			projectId: String(raw.projectId ?? project.id ?? ''),
			workDayId: typeof raw.workDayId === 'string' ? raw.workDayId : null,
			environment: String(raw.environment ?? 'staging'),
			availableCredits: numberOrNull(capacity.availableCredits),
			reservedCredits: numberOrNull(capacity.reservedCredits),
			consumedCredits: numberOrNull(capacity.consumedCredits),
			metadata: capacity,
		},
		assignableProviders: providers.map((provider) => {
			const entry = record(provider);
			return {
				capacityProviderId: String(entry.id ?? entry.capacityProviderId ?? ''),
				executionProviderId: typeof entry.executionProviderId === 'string' ? entry.executionProviderId : null,
				laneId: typeof entry.laneId === 'string' ? entry.laneId : null,
				availableCredits: numberOrNull(entry.availableCredits),
				reasons: Array.isArray(entry.reasons) ? entry.reasons.map(String) : [],
				metadata: entry,
			};
		}).filter((provider) => provider.capacityProviderId),
		legacyPlan: plan,
		metadata: {
			source: 'legacy_capacity_plan',
		},
	};
}

export function deriveAgentCapacityEnvelopeFromReservation(input: {
	reservation: CapacityReservation;
	mode: AgentExecutionMode;
	projectAgentClassId?: string | null;
	allocationSetId?: string | null;
	environment?: string | null;
	limits?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}): AgentCapacityEnvelope {
	const reservation = input.reservation;
	return {
		teamId: reservation.teamId,
		projectId: reservation.projectId,
		workDayId: reservation.workDayId,
		environment: input.environment ?? null,
		allocationSetId: input.allocationSetId ?? null,
		mode: input.mode,
		projectAgentClassId: input.projectAgentClassId ?? null,
		capacityProviderId: reservation.capacityProviderId,
		executionProviderId: reservation.executionProviderId ?? null,
		laneId: reservation.laneId,
		reservationId: reservation.id,
		availableCredits: null,
		reservedCredits: reservation.reservedCredits,
		consumedCredits: reservation.consumedCredits,
		nativeUnit: reservation.nativeUnit ?? null,
		reservedNativeAmount: reservation.reservedNativeAmount ?? null,
		limits: input.limits ?? {},
		metadata: {
			...(reservation.metadata ?? {}),
			...(input.metadata ?? {}),
		},
	};
}

export function deriveModeRunUsageSettlement(actual: TaskUsageActual): AgentModeRunUsageSettlement {
	return {
		taskUsageActualId: actual.id,
		capacityLedgerEntryId: typeof actual.metadata?.capacityLedgerEntryId === 'string' ? actual.metadata.capacityLedgerEntryId : null,
		actualCredits: actual.actualCredits,
		actualUsd: actual.actualUsd,
		nativeUsage: record(actual.nativeUsage),
		metadata: actual.metadata ?? {},
	};
}

export function isAgentExecutionMode(value: unknown): value is AgentExecutionMode {
	return value === 'planning' || value === 'acting';
}

export function normalizeAgentExecutionMode(value: unknown, fallback: AgentExecutionMode = 'planning'): AgentExecutionMode {
	return isAgentExecutionMode(value) ? value : fallback;
}

export function createAgentKernelModeFallback(
	code: AgentKernelModeFallbackCode | string,
	reason: string,
	options: { retryable?: boolean; metadata?: Record<string, unknown> } = {},
): AgentKernelModeFallback {
	return {
		code,
		reason,
		retryable: options.retryable ?? true,
		metadata: options.metadata ?? {},
	};
}

export function isAgentModeAllowedForClass(
	mode: AgentExecutionMode,
	agentClass?: Pick<ProjectAgentClass, 'allowedModes' | 'status'> | null,
	profile?: Pick<AgentKernelProfile, 'allowedModes'> | null,
): boolean {
	if (agentClass?.status && agentClass.status !== 'active') return false;
	const classModes = Array.isArray(agentClass?.allowedModes) ? agentClass.allowedModes : [];
	if (classModes.length && !classModes.includes(mode)) return false;
	const profileModes = Array.isArray(profile?.allowedModes) ? profile.allowedModes : [];
	if (profileModes.length && !profileModes.includes(mode)) return false;
	return true;
}

export function deriveAgentCapacityEnvelopeFromAssignment(
	assignment: Pick<ProviderAssignment,
		'teamId' | 'projectId' | 'mode' | 'capacityProviderId' | 'executionProviderId' | 'allocationSetId' |
		'projectAgentClassId' | 'reservationId' | 'workDayId' | 'capacityEnvelope'>,
): AgentCapacityEnvelope {
	const envelope = record(assignment.capacityEnvelope);
	return {
		teamId: String(envelope.teamId ?? assignment.teamId),
		projectId: String(envelope.projectId ?? assignment.projectId),
		workDayId: typeof envelope.workDayId === 'string' ? envelope.workDayId : assignment.workDayId ?? null,
		environment: typeof envelope.environment === 'string' ? envelope.environment : null,
		allocationSetId: typeof envelope.allocationSetId === 'string' ? envelope.allocationSetId : assignment.allocationSetId ?? null,
		mode: normalizeAgentExecutionMode(envelope.mode ?? assignment.mode),
		projectAgentClassId: typeof envelope.projectAgentClassId === 'string' ? envelope.projectAgentClassId : assignment.projectAgentClassId,
		capacityProviderId: typeof envelope.capacityProviderId === 'string' ? envelope.capacityProviderId : assignment.capacityProviderId,
		executionProviderId: typeof envelope.executionProviderId === 'string' ? envelope.executionProviderId : assignment.executionProviderId ?? null,
		laneId: typeof envelope.laneId === 'string' ? envelope.laneId : null,
		reservationId: typeof envelope.reservationId === 'string' ? envelope.reservationId : assignment.reservationId ?? null,
		nativeUnit: typeof envelope.nativeUnit === 'string' ? envelope.nativeUnit : null,
		reservedNativeAmount: numberOrNull(envelope.reservedNativeAmount),
		availableCredits: numberOrNull(envelope.availableCredits),
		reservedCredits: numberOrNull(envelope.reservedCredits),
		consumedCredits: numberOrNull(envelope.consumedCredits),
		limits: record(envelope.limits),
		metadata: record(envelope.metadata),
	};
}

export function deriveDecisionExecutionInputFromAssignment(
	assignment: Pick<ProviderAssignment,
		'teamId' | 'projectId' | 'projectAgentClassId' | 'mode' | 'taskId' | 'workDayId' | 'agentId' |
		'handlerId' | 'decisionInput' | 'capacityEnvelope'>,
): DecisionExecutionInput {
	const decision = record(assignment.decisionInput);
	return {
		teamId: String(decision.teamId ?? assignment.teamId),
		projectId: String(decision.projectId ?? assignment.projectId),
		projectAgentClassId: String(decision.projectAgentClassId ?? assignment.projectAgentClassId),
		mode: normalizeAgentExecutionMode(decision.mode ?? assignment.mode),
		taskId: typeof decision.taskId === 'string' ? decision.taskId : assignment.taskId ?? null,
		workDayId: typeof decision.workDayId === 'string' ? decision.workDayId : assignment.workDayId ?? null,
		agentId: typeof decision.agentId === 'string' ? decision.agentId : assignment.agentId ?? null,
		handlerId: typeof decision.handlerId === 'string' ? decision.handlerId : assignment.handlerId ?? null,
		capacity: deriveAgentCapacityEnvelopeFromAssignment(assignment),
		input: record(decision.input),
		metadata: record(decision.metadata),
	};
}

export function validateAgentKernelModeExecutionInput(input: AgentKernelModeExecutionInput): AgentKernelModeFallback | null {
	const assignment = input.assignment;
	const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
	if (isProviderAssignmentLeaseExpired(assignment, now)) {
		return createAgentKernelModeFallback(
			'assignment_lease_expired',
			`Assignment ${assignment.id} lease expired before execution.`,
			{ retryable: true },
		);
	}
	if (!assignment.projectId || !assignment.agentId && !deriveDecisionExecutionInputFromAssignment(assignment).agentId) {
		return createAgentKernelModeFallback(
			'assignment_missing_project_or_agent',
			`Assignment ${assignment.id} is missing project or agent routing.`,
			{ retryable: false },
		);
	}
	const mode = normalizeAgentExecutionMode(assignment.mode);
	const profile = input.kernelProfile ?? input.projectAgentClass?.kernelProfile ?? null;
	if (!isAgentModeAllowedForClass(mode, input.projectAgentClass, profile)) {
		return createAgentKernelModeFallback(
			'assignment_mode_not_allowed',
			`Assignment ${assignment.id} mode ${mode} is not allowed for the project agent class.`,
			{ retryable: false },
		);
	}
	const capacity = input.capacityEnvelope ?? deriveAgentCapacityEnvelopeFromAssignment(assignment);
	if (capacity.mode !== mode) {
		return createAgentKernelModeFallback(
			'assignment_missing_capacity_envelope',
			`Assignment ${assignment.id} capacity envelope does not match selected mode ${mode}.`,
			{ retryable: false },
		);
	}
	const decision = input.decisionInput ?? deriveDecisionExecutionInputFromAssignment(assignment);
	if (decision.mode !== mode || decision.projectId !== assignment.projectId) {
		return createAgentKernelModeFallback(
			'assignment_missing_decision_input',
			`Assignment ${assignment.id} decision input does not match assignment scope.`,
			{ retryable: false },
		);
	}
	if (mode === 'acting' && input.readiness && !isDecisionReadyForActing(input.readiness)) {
		return createAgentKernelModeFallback(
			'assignment_decision_not_ready',
			`Assignment ${assignment.id} is not ready for acting execution.`,
			{ retryable: true, metadata: { readiness: input.readiness } },
		);
	}
	const proxyFallback = validateTreeDxProxyHandle(input.treedxProxyHandle ?? record(assignment.treedxProxyHandle) as TreeDxProxyHandle, {
		teamId: assignment.teamId,
		projectId: assignment.projectId,
		assignmentId: assignment.id,
	});
	if (proxyFallback) return proxyFallback;
	return null;
}

export function isProviderAssignmentLeaseExpired(assignment: Pick<ProviderAssignment, 'leaseExpiresAt'>, now = new Date()): boolean {
	if (!assignment.leaseExpiresAt) return false;
	const expiresAt = Date.parse(assignment.leaseExpiresAt);
	return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

export function isProviderAssignmentLeasable(assignment: Pick<ProviderAssignment, 'status' | 'leaseState' | 'leaseExpiresAt'>, now = new Date()): boolean {
	if (assignment.status === 'pending' && assignment.leaseState === 'unleased') return true;
	if (assignment.status === 'returned' && assignment.leaseState === 'released') return true;
	if (assignment.leaseState === 'leased' && isProviderAssignmentLeaseExpired(assignment, now)) return true;
	return false;
}
