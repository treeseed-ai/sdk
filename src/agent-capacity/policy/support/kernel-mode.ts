import type { CapacityLedgerEntry, CapacityReservation, CapacityUsageActual } from '../../contracts/support/financial-records.ts';
import { AGENT_ASSIGNMENT_WORKSPACE_ACCESS_MODES, type AgentAssignmentWorkspaceAccessMode, type AgentCapacityEnvelope, type AgentExecutionMode, type AgentModeRunUsageSettlement, type DecisionExecutionInput, type ProviderAssignment, type ProviderAssignmentCapabilityHandles, type ProviderAssignmentSynthesisSource, type TreeDxProxyHandle, type WorkdayCapacityEnvelope } from '../../contracts/capacity/assignments/assignment-records.ts';
import type { CapacityGrantV2 } from '../../allocation.ts';
import type { AgentCapacityPlanRecord, AgentCapacityPlanWorkUnit, DecisionExecutionInputRecord, DecisionPlanningStatus, PlanningInputRequest } from '../../contracts/support/planning-records.ts';
import type { AgentKernelPolicy, AgentKernelProfile, ProjectAgentClass } from '../../contracts/projects/agents/project-agent-class.ts';
import type { CapacityExecutionProvider, ProviderAvailabilitySession } from '../../../capacity-provider/contracts/index.ts';
import type { AgentRuntimeSpec, AgentWorkPackage, ExecutionCapabilityDemand, ExecutionCapabilitySupply, ExecutionProviderDescriptor, ExecutionResourceNeed } from '../../../types/agents.ts';
import type { AgentCapacityPlan, AgentKernelModeDecision, AgentKernelModeExecutionInput, AgentKernelModeFallback, AgentKernelModeFallbackCode, AgentKernelOutputValidationResult, AgentKernelQueueObservation, BuildExecutionProviderAssignmentExplanationInput, CapacityRuntimeBlockerVm, CapacityRuntimeDiagnosticsResponse, CapacitySettlementInvariantResult, CapacitySettlementInvariantViolation, ExecutionCapabilityGateInput, ExecutionProviderEligibilityResult, ExecutionProviderVisibilitySummary, ProviderAssignmentExplanation, ProviderAssignmentSynthesisCandidate, TreeDxProxyAccessRequest, TreeDxProxyAccessResult } from '../../contracts/runtime/runtime-observability.ts';
import { arrayValue, booleanDefault, booleanOrNull, collectSupplyMetadataAliases, collectSupplyMetadataCapabilities, firstArray, firstString, handleResourceNeed, isRecord, numberOrNull, preferredCapabilitiesFromAgent, pressureAllows, pushResourceNeed, record, stableStringify, stringList, stringOrNull, uniqueStrings } from './primitives.ts';
import { createAgentKernelModeFallback, normalizeAgentExecutionMode } from './mode-primitives.ts';
import { hasAcceptedCapacityPlanProvenance, isDecisionReadyForActing } from './planning.ts';
import { validateProviderAssignmentCapabilityHandles, validateTreeDxProxyHandle } from '../capacity/assignments/assignment-capability.ts';
import { isProviderAssignmentLeaseExpired } from '../runtime/runtime-diagnostics.ts';
import { compileExecutionCapabilityDemand } from './execution-capability.ts';

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

export function deriveModeRunUsageSettlement(actual: CapacityUsageActual): AgentModeRunUsageSettlement {
	return {
		capacityUsageActualId: actual.id,
		capacityLedgerEntryId: typeof actual.metadata?.capacityLedgerEntryId === 'string' ? actual.metadata.capacityLedgerEntryId : null,
		actualCredits: actual.actualCredits,
		actualUsd: actual.actualUsd,
		nativeUsage: record(actual.nativeUsage),
		metadata: actual.metadata ?? {},
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
	if (mode === 'acting' && !input.readiness) {
		return createAgentKernelModeFallback(
			'assignment_decision_not_ready',
			`Assignment ${assignment.id} is missing decision readiness for acting execution.`,
			{ retryable: true },
		);
	}
	if (mode === 'acting' && (!capacity.reservationId || Number(capacity.reservedCredits ?? 0) <= 0)) {
		return createAgentKernelModeFallback(
			'assignment_capacity_not_reserved',
			`Assignment ${assignment.id} is missing reserved capacity for acting execution.`,
			{ retryable: true, metadata: { reservationId: capacity.reservationId ?? null, reservedCredits: capacity.reservedCredits ?? null } },
		);
	}
	const activityType = String(record(decision.metadata).activityType ?? record(capacity.metadata).activityType ?? '');
	const deterministicSystemReport = mode === 'planning'
		&& activityType === 'reporting'
		&& record(capacity.metadata).deterministicSystemReport === true;
	if (mode === 'planning' && !deterministicSystemReport && (!capacity.reservationId || Number(capacity.reservedCredits ?? 0) <= 0)) {
		return createAgentKernelModeFallback(
			'assignment_capacity_not_reserved',
			`Assignment ${assignment.id} is missing reserved capacity for planning execution.`,
			{ retryable: true, metadata: { reservationId: capacity.reservationId ?? null, reservedCredits: capacity.reservedCredits ?? null, activityType: activityType || null } },
		);
	}
	if (mode === 'acting' && !hasAcceptedCapacityPlanProvenance({ assignment, decisionInput: decision, capacityEnvelope: capacity })) {
		return createAgentKernelModeFallback(
			'assignment_capacity_plan_not_accepted',
			`Assignment ${assignment.id} is missing accepted capacity-plan provenance for acting execution.`,
			{ retryable: true },
		);
	}
	const policyMaxAttempts = numberOrNull(record(input.kernelPolicy?.fallback).maxAttempts)
		?? numberOrNull(record(input.projectAgentClass?.kernelPolicy?.fallback).maxAttempts)
		?? numberOrNull(record(input.kernelProfile?.metadata).maxAttempts);
	if (policyMaxAttempts !== null && Number(assignment.attemptCount ?? 0) >= policyMaxAttempts) {
		return createAgentKernelModeFallback(
			'assignment_retry_policy_exceeded',
			`Assignment ${assignment.id} has exceeded kernel retry policy.`,
			{ retryable: false, metadata: { attemptCount: assignment.attemptCount ?? 0, maxAttempts: policyMaxAttempts } },
		);
	}
	const assignmentMetadata = record(assignment.metadata);
	const eligibility = record(assignmentMetadata.eligibility);
	const eligibilityGates = record(eligibility.gates);
	const explanationGates = record(record(assignment.explanation).gates);
	const explanationSupply = record(explanationGates.supply);
	const explanationCapabilitySupply = record(explanationGates.capabilitySupply);
	const demand = compileExecutionCapabilityDemand({
		projectAgentClass: input.projectAgentClass,
		decisionInput: decision,
		capacityEnvelope: capacity,
		assignment,
		mode,
	});
	const requiredCapabilities = uniqueStrings([
		...demand.required,
		...stringList(input.projectAgentClass?.requiredCapabilities),
		...stringList(assignmentMetadata.requiredCapabilities),
		...stringList(record(decision.metadata).requiredCapabilities),
		...stringList(record(capacity.metadata).requiredCapabilities),
	]);
	const availableCapabilities = uniqueStrings([
		...stringList(eligibilityGates.availableCapabilities),
		...stringList(explanationGates.availableCapabilities),
		...stringList(explanationGates.aliasCapabilities),
		...stringList(explanationSupply.capabilities),
		...stringList(explanationSupply.aliases),
		...stringList(explanationCapabilitySupply.capabilities),
		...stringList(explanationCapabilitySupply.aliases),
		...stringList(assignmentMetadata.availableCapabilities),
	]);
	const missingCapabilities = requiredCapabilities.filter((capability) => !availableCapabilities.includes(capability));
	if (requiredCapabilities.length && (!availableCapabilities.length || missingCapabilities.length)) {
		return createAgentKernelModeFallback(
			'assignment_eligibility_capability_mismatch',
			`Assignment ${assignment.id} required capabilities were not covered by eligibility metadata.`,
			{ retryable: true, metadata: { requiredCapabilities, availableCapabilities, missingCapabilities, source: 'execution_capability_eligibility' } },
		);
	}
	const capabilityHandleFallback = validateProviderAssignmentCapabilityHandles({
		assignment,
		decisionInput: decision,
		capacityEnvelope: capacity,
		now,
	});
	if (capabilityHandleFallback) return capabilityHandleFallback;
	const proxyFallback = validateTreeDxProxyHandle(input.treedxProxyHandle ?? record(assignment.treedxProxyHandle) as TreeDxProxyHandle, {
		teamId: assignment.teamId,
		projectId: assignment.projectId,
		assignmentId: assignment.id,
	});
	if (proxyFallback) return proxyFallback;
	return null;
}

export function selectAgentKernelModeDecision(observation: AgentKernelQueueObservation): AgentKernelModeDecision {
	const planningReady = Math.max(0, Number(observation.planningReady ?? 0));
	const actingReady = Math.max(0, Number(observation.actingReady ?? 0));
	const fallbackReady = Math.max(0, Number(observation.fallbackReady ?? 0));
	const planningBudget = Number(observation.planningBudgetCredits ?? 0);
	const actingBudget = Number(observation.actingBudgetCredits ?? 0);
	const hasPlanningBudget = !Number.isFinite(planningBudget) || planningBudget > 0;
	const hasActingBudget = !Number.isFinite(actingBudget) || actingBudget > 0;
	if (observation.modePreference === 'planning' && planningReady > 0 && hasPlanningBudget) {
		return { kind: 'mode', mode: 'planning', reason: 'preferred_planning_ready', metadata: observation.metadata ?? {} };
	}
	if (observation.modePreference === 'acting' && actingReady > 0 && hasActingBudget) {
		return { kind: 'mode', mode: 'acting', reason: 'preferred_acting_ready', metadata: observation.metadata ?? {} };
	}
	if (actingReady > 0 && hasActingBudget) {
		return { kind: 'mode', mode: 'acting', reason: 'acting_queue_ready', metadata: observation.metadata ?? {} };
	}
	if (planningReady > 0 && hasPlanningBudget) {
		return { kind: 'mode', mode: 'planning', reason: 'planning_queue_ready', metadata: observation.metadata ?? {} };
	}
	if (fallbackReady > 0) {
		return { kind: 'fallback', mode: null, reason: 'fallback_queue_ready', metadata: observation.metadata ?? {} };
	}
	return { kind: 'idle', mode: null, reason: 'no_eligible_work', metadata: observation.metadata ?? {} };
}

export function validateAgentKernelOutputs(input: {
	mode: AgentExecutionMode;
	outputs?: Record<string, unknown> | null;
	allowedOutputs?: Record<string, unknown> | null;
}): AgentKernelOutputValidationResult {
	const allowed = record(input.allowedOutputs);
	if (!Object.keys(allowed).length) return { ok: true };
	const outputs = record(input.outputs);
	const allowedStatuses = Array.isArray(allowed.statuses) ? allowed.statuses.map(String) : [];
	const status = typeof outputs.status === 'string' ? outputs.status : null;
	if (allowedStatuses.length && (!status || !allowedStatuses.includes(status))) {
		return { ok: false, reason: `Output status ${status ?? '<missing>'} is not allowed for ${input.mode}.`, metadata: { status, allowedStatuses } };
	}
	const allowedTypes = Array.isArray(allowed.types) ? allowed.types.map(String) : [];
	const metadata = record(outputs.metadata);
	const outputType = typeof metadata.type === 'string'
		? metadata.type
		: typeof metadata.kind === 'string'
			? metadata.kind
			: null;
	if (allowedTypes.length && (!outputType || !allowedTypes.includes(outputType))) {
		return { ok: false, reason: `Output type ${outputType ?? '<missing>'} is not allowed for ${input.mode}.`, metadata: { outputType, allowedTypes } };
	}
	return { ok: true };
}

export function treeDxProxyHeaders(handle: TreeDxProxyHandle): Record<string, string> {
	const headers: Record<string, string> = {
		'x-treeseed-assignment-id': String(handle.assignmentId ?? ''),
		'x-treeseed-treedx-proxy-handle-id': String(handle.id ?? ''),
	};
	if (handle.token) headers['x-treeseed-treedx-proxy-handle'] = handle.token;
	return Object.fromEntries(Object.entries(headers).filter(([, value]) => value));
}
