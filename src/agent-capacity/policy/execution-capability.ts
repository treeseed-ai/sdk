import type { CapacityLedgerEntry, CapacityReservation, CapacityUsageActual } from '../contracts/financial-records.ts';
import { AGENT_ASSIGNMENT_WORKSPACE_ACCESS_MODES, type AgentAssignmentWorkspaceAccessMode, type AgentCapacityEnvelope, type AgentExecutionMode, type AgentModeRunUsageSettlement, type DecisionExecutionInput, type ProviderAssignment, type ProviderAssignmentCapabilityHandles, type ProviderAssignmentSynthesisSource, type TreeDxProxyHandle, type WorkdayCapacityEnvelope } from '../contracts/assignment-records.ts';
import type { CapacityGrantV2 } from '../allocation.ts';
import type { AgentCapacityPlanRecord, AgentCapacityPlanWorkUnit, DecisionExecutionInputRecord, DecisionPlanningStatus, PlanningInputRequest } from '../contracts/planning-records.ts';
import type { AgentKernelPolicy, AgentKernelProfile, ProjectAgentClass } from '../contracts/project-agent-class.ts';
import type { CapacityExecutionProvider, ProviderAvailabilitySession } from '../../capacity-provider/contracts/index.ts';
import type { AgentRuntimeSpec, AgentWorkPackage, ExecutionCapabilityDemand, ExecutionCapabilitySupply, ExecutionProviderDescriptor, ExecutionResourceNeed } from '../../types/agents.ts';
import type { AgentCapacityPlan, AgentKernelModeDecision, AgentKernelModeExecutionInput, AgentKernelModeFallback, AgentKernelModeFallbackCode, AgentKernelOutputValidationResult, AgentKernelQueueObservation, BuildExecutionProviderAssignmentExplanationInput, CapacityRuntimeBlockerVm, CapacityRuntimeDiagnosticsResponse, CapacitySettlementInvariantResult, CapacitySettlementInvariantViolation, ExecutionCapabilityGateInput, ExecutionProviderEligibilityResult, ExecutionProviderVisibilitySummary, ProviderAssignmentExplanation, ProviderAssignmentSynthesisCandidate, TreeDxProxyAccessRequest, TreeDxProxyAccessResult } from '../contracts/runtime-observability.ts';
import { arrayValue, booleanDefault, booleanOrNull, capabilityHandleArrays, collectSupplyMetadataAliases, collectSupplyMetadataCapabilities, firstArray, firstString, handleResourceNeed, isRecord, numberOrNull, preferredCapabilitiesFromAgent, pressureAllows, pushResourceNeed, record, stableStringify, stringList, stringOrNull, uniqueStrings } from './primitives.ts';
import { normalizeAgentExecutionMode } from './mode-primitives.ts';

export function compileExecutionCapabilityDemand(input: {
	agent?: Pick<AgentRuntimeSpec, 'execution' | 'outputs'> | null;
	projectAgentClass?: Pick<ProjectAgentClass, 'requiredCapabilities'> | null;
	decisionInput?: DecisionExecutionInput | Record<string, unknown> | null;
	capacityEnvelope?: AgentCapacityEnvelope | Record<string, unknown> | null;
	workUnit?: Pick<AgentCapacityPlanWorkUnit, 'requiredCapabilities' | 'metadata'> | null;
	assignment?: Pick<ProviderAssignment, 'mode' | 'metadata' | 'workspaceContext' | 'capabilityHandles' | 'allowedOutputs'> | null;
	workPackage?: AgentWorkPackage | null;
	mode?: AgentExecutionMode | string | null;
	resourceNeeds?: ExecutionResourceNeed[];
	metadata?: Record<string, unknown>;
}): ExecutionCapabilityDemand {
	const agentProfile = input.agent?.execution.providerProfile;
	const decisionInput = record(input.decisionInput);
	const decisionPayload = record(decisionInput.input);
	const decisionMetadata = record(decisionInput.metadata);
	const capacityMetadata = record(record(input.capacityEnvelope).metadata);
	const workUnitMetadata = record(input.workUnit?.metadata);
	const assignmentMetadata = record(input.assignment?.metadata);
	const allowedOutputs = record(input.assignment?.allowedOutputs);
	const allowedPaths = uniqueStrings([
		...stringList(input.agent?.execution.allowedPaths),
		...stringList(input.workPackage?.constraints.allowedPaths),
	]);
	const forbiddenPaths = uniqueStrings([
		...stringList(input.agent?.execution.forbiddenPaths),
		...stringList(input.workPackage?.constraints.forbiddenPaths),
	]);
	const required = uniqueStrings([
		...stringList(agentProfile?.requiredCapabilities),
		...stringList(input.projectAgentClass?.requiredCapabilities),
		...stringList(decisionPayload.requiredCapabilities),
		...stringList(decisionMetadata.requiredCapabilities),
		...stringList(capacityMetadata.requiredCapabilities),
		...stringList(input.workUnit?.requiredCapabilities),
		...stringList(workUnitMetadata.requiredCapabilities),
		...stringList(assignmentMetadata.requiredCapabilities),
		...stringList(input.workPackage?.constraints.requiredCapabilities),
	]);
	const preferred = preferredCapabilitiesFromAgent(input.agent);
	const outputTypes = uniqueStrings([
		...stringList(input.agent?.outputs.messageTypes),
		...stringList(input.agent?.outputs.modelMutations),
		...stringList(allowedOutputs.types),
		...(input.workPackage?.expectedOutputs ?? []).map((entry) => entry.type).filter(Boolean),
	]);
	const resourceNeeds: ExecutionResourceNeed[] = [];
	for (const need of input.resourceNeeds ?? []) {
		pushResourceNeed(resourceNeeds, need);
	}
	for (const handle of capabilityHandleArrays(input.assignment?.capabilityHandles)) {
		const need = handleResourceNeed(handle);
		if (need) pushResourceNeed(resourceNeeds, need);
	}
	const workspace = record(input.assignment?.workspaceContext);
	if (workspace.externalIssue || workspace.externalIssueKey) {
		pushResourceNeed(resourceNeeds, {
			kind: 'external_issue',
			operations: ['read'],
			required: true,
			metadata: {
				externalRef: String(workspace.externalIssueKey ?? workspace.externalIssue),
			},
		});
	}
	if (workspace.externalJob || workspace.externalJobId) {
		pushResourceNeed(resourceNeeds, {
			kind: 'external_job',
			operations: ['read'],
			required: true,
			metadata: {
				externalRef: String(workspace.externalJobId ?? workspace.externalJob),
			},
		});
	}
	return {
		required,
		preferred,
		mode: normalizeAgentExecutionMode(input.mode ?? input.assignment?.mode ?? input.workPackage?.constraints.mode ?? input.capacityEnvelope?.mode),
		resourceNeeds,
		outputTypes,
		metadata: {
			...(input.metadata ?? {}),
			allowedPaths,
			forbiddenPaths,
			providerProfile: agentProfile ?? null,
		},
	};
}

export function compileExecutionCapabilitySupply(input: {
	capacityProviderId: string;
	executionProviderId?: string | null;
	kind?: string | null;
	descriptor?: ExecutionProviderDescriptor | null;
	executionProvider?: CapacityExecutionProvider | null;
	availabilitySession?: ProviderAvailabilitySession | null;
	providerCapabilities?: string[] | unknown[] | null;
	checkInCapabilities?: string[] | unknown[] | null;
	grants?: CapacityGrantV2[];
	pressure?: ExecutionCapabilitySupply['pressure'];
	maxConcurrentAssignments?: number | null;
	metadata?: Record<string, unknown>;
}): ExecutionCapabilitySupply {
	const executionProvider = input.executionProvider ?? null;
	const availability = input.availabilitySession ?? null;
	const observation = record(executionProvider?.latestObservation);
	const metadata = record(executionProvider?.metadata);
	const activeGrants = (input.grants ?? []).filter((grant) => grant.status === 'active');
	const pressure = input.pressure
		?? (typeof availability?.snapshot.pressure === 'string'
			? availability.snapshot.pressure as ExecutionCapabilitySupply['pressure']
			: undefined)
		?? (observation.throttleState === 'exhausted' || observation.throttleState === 'throttled'
			? observation.throttleState as ExecutionCapabilitySupply['pressure']
			: undefined)
		?? 'normal';
	return {
		capacityProviderId: input.capacityProviderId,
		executionProviderId: input.executionProviderId ?? executionProvider?.id ?? input.descriptor?.id ?? input.capacityProviderId,
		kind: input.kind ?? input.descriptor?.kind ?? executionProvider?.adapter ?? 'local_process',
		capabilities: uniqueStrings([
			...stringList(input.descriptor?.capabilities),
			...(executionProvider?.adapter ? [executionProvider.adapter] : []),
			...collectSupplyMetadataCapabilities(executionProvider),
			...stringList(availability?.snapshot.capabilities),
			...stringList(input.providerCapabilities),
			...stringList(input.checkInCapabilities),
		]),
		aliases: uniqueStrings([
			...stringList(input.descriptor?.capabilityAliases),
			...collectSupplyMetadataAliases(executionProvider),
		]),
		grants: uniqueStrings([
			...activeGrants.map((grant) => grant.id),
			...stringList(metadata.grants),
		]),
		availability: availability ? {
			sessionId: availability.id,
			status: availability.status,
			checkedInAt: availability.refreshedAt,
		} : undefined,
		pressure,
		maxConcurrentAssignments: input.descriptor?.maxConcurrentAssignments
			?? executionProvider?.maxConcurrentRunners
			?? input.maxConcurrentAssignments
			?? 1,
		nativeUnit: input.descriptor?.nativeUnit ?? executionProvider?.nativeUnit ?? 'assignment',
		quotaVisibility: input.descriptor?.quotaVisibility ?? executionProvider?.quotaVisibility ?? 'opaque',
		metadata: {
			...(input.metadata ?? {}),
			activeGrantIds: activeGrants.map((grant) => grant.id),
		},
	};
}

export function evaluateExecutionProviderEligibility(input: {
	demand: ExecutionCapabilityDemand;
	supply: ExecutionCapabilitySupply;
	gates?: ExecutionCapabilityGateInput;
}): ExecutionProviderEligibilityResult {
	const requiredCapabilities = uniqueStrings(input.demand.required);
	const preferredCapabilities = uniqueStrings(input.demand.preferred ?? []);
	const availableCapabilities = uniqueStrings(input.supply.capabilities);
	const aliasCapabilities = uniqueStrings(input.supply.aliases ?? []);
	const covered = new Set([...availableCapabilities, ...aliasCapabilities]);
	const missingCapabilities = requiredCapabilities.filter((capability) => !covered.has(capability));
	const gates = {
		grantMatches: booleanDefault(input.gates?.grantMatches, true),
		availabilityMatches: booleanDefault(input.gates?.availabilityMatches, true),
		runnerPressureAllows: booleanDefault(input.gates?.runnerPressureAllows, pressureAllows(input.supply.pressure)),
		budgetAllows: booleanDefault(input.gates?.budgetAllows, true),
		readinessAllows: booleanDefault(input.gates?.readinessAllows, true),
		capabilityHandlesCanBeIssued: booleanDefault(input.gates?.capabilityHandlesCanBeIssued, true),
	};
	const reasonCodes = [
		...missingCapabilities.map((capability) => `missing_capability:${capability}`),
		...(gates.grantMatches ? [] : ['grant_mismatch']),
		...(gates.availabilityMatches ? [] : ['availability_mismatch']),
		...(gates.runnerPressureAllows ? [] : ['runner_pressure_blocked']),
		...(gates.budgetAllows ? [] : ['budget_blocked']),
		...(gates.readinessAllows ? [] : ['readiness_blocked']),
		...(gates.capabilityHandlesCanBeIssued ? [] : ['capability_handle_blocked']),
	];
	return {
		eligible: missingCapabilities.length === 0 && Object.values(gates).every(Boolean),
		requiredCapabilities,
		preferredCapabilities,
		availableCapabilities,
		aliasCapabilities,
		missingCapabilities,
		reasonCodes,
		gates,
		metadata: input.gates?.metadata,
	};
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

export function buildExecutionProviderAssignmentExplanation(
	input: BuildExecutionProviderAssignmentExplanationInput,
): ProviderAssignmentExplanation {
	return buildProviderAssignmentExplanation({
		source: input.source,
		sourceId: input.sourceId,
		eligible: input.eligibility.eligible,
		reasons: input.eligibility.reasonCodes,
		allocationPolicyVersion: input.allocationPolicyVersion ?? null,
		grantScope: input.grantScope ?? null,
		gates: {
			requiredCapabilities: input.eligibility.requiredCapabilities,
			preferredCapabilities: input.eligibility.preferredCapabilities,
			availableCapabilities: input.eligibility.availableCapabilities,
			aliasCapabilities: input.eligibility.aliasCapabilities,
			missingCapabilities: input.eligibility.missingCapabilities,
			selectedProvider: input.supply.capacityProviderId,
			selectedExecutionProvider: input.supply.executionProviderId,
			executionProviderKind: input.supply.kind,
			grantId: input.grantId ?? null,
			grantScope: input.grantScope ?? null,
			readinessGate: input.readinessGate ?? null,
			allocationBudgetGate: input.allocationBudgetGate ?? null,
			capabilityHandleGate: input.capabilityHandleGate ?? null,
			demand: input.demand,
			supply: input.supply,
			eligibility: input.eligibility,
		},
		metadata: input.metadata,
	});
}

function visibilityGateRecord(input: {
	assignment?: Record<string, unknown> | null;
	explanation?: Record<string, unknown> | null;
}) {
	const assignment = record(input.assignment);
	const explicitExplanation = record(input.explanation);
	const assignmentExplanation = record(assignment.explanation);
	const assignmentMetadata = record(assignment.metadata);
	const eligibility = record(assignmentMetadata.eligibility);
	const explicitGates = record(explicitExplanation.gates);
	const assignmentGates = record(assignmentExplanation.gates);
	if (Object.keys(explicitGates).length > 0) return explicitGates;
	if (Object.keys(assignmentGates).length > 0) return assignmentGates;
	return record(eligibility.gates);
}

function visibilityReasonCodes(input: {
	assignment?: Record<string, unknown> | null;
	explanation?: Record<string, unknown> | null;
	gates: Record<string, unknown>;
}) {
	const eligibility = record(input.gates.eligibility);
	const explicitExplanation = record(input.explanation);
	const assignmentExplanation = record(record(input.assignment).explanation);
	return uniqueStrings([
		...stringList(eligibility.reasonCodes),
		...stringList(explicitExplanation.reasons),
		...stringList(assignmentExplanation.reasons),
	]);
}

function visibilityCapabilityEligible(input: {
	assignment?: Record<string, unknown> | null;
	explanation?: Record<string, unknown> | null;
	gates: Record<string, unknown>;
}) {
	const eligibility = record(input.gates.eligibility);
	return booleanOrNull(eligibility.eligible)
		?? booleanOrNull(record(input.explanation).eligible)
		?? booleanOrNull(record(record(input.assignment).explanation).eligible);
}

export function summarizeExecutionProviderVisibility(input: {
	assignment?: Record<string, unknown> | null;
	modeRun?: Record<string, unknown> | null;
	explanation?: Record<string, unknown> | null;
}): ExecutionProviderVisibilitySummary {
	const assignment = record(input.assignment);
	const modeRun = record(input.modeRun);
	const explanation = record(input.explanation);
	const lifecycleOutput = record(assignment.lifecycleOutput);
	const lifecycleMetadata = record(lifecycleOutput.metadata);
	const modeOutputs = record(modeRun.outputs);
	const modeOutputMetadata = record(modeOutputs.metadata);
	const modeMetadata = record(modeRun.metadata);
	const traceRefs = record(modeRun.traceRefs);
	const gates = visibilityGateRecord({ assignment, explanation });
	const supply = record(gates.supply);
	const capabilitySupply = record(gates.capabilitySupply);
	const eligibility = record(gates.eligibility);
	const selectedExecutionProvider = firstString(
		gates.selectedExecutionProvider,
		supply.executionProviderId,
		capabilitySupply.executionProviderId,
		modeRun.executionProviderId,
		assignment.executionProviderId,
	);
	const executionProviderKind = firstString(
		gates.executionProviderKind,
		supply.kind,
		capabilitySupply.kind,
		assignment.executionProviderKind,
		record(assignment.metadata).executionProviderKind,
		modeOutputMetadata.provider,
		modeMetadata.provider,
		lifecycleMetadata.provider,
	);

	return {
		executionProviderId: firstString(
			modeRun.executionProviderId,
			assignment.executionProviderId,
			selectedExecutionProvider,
		),
		executionProviderKind,
		adapterStatus: firstString(
			modeOutputs.status,
			modeOutputMetadata.executionStatus,
			modeMetadata.executionStatus,
			lifecycleMetadata.executionStatus,
			lifecycleOutput.status,
			assignment.status,
		),
		externalRef: firstString(
			modeOutputs.externalRef,
			traceRefs.externalRef,
			lifecycleOutput.externalRef,
			lifecycleMetadata.externalRef,
		),
		externalUrl: firstString(
			modeOutputs.externalUrl,
			traceRefs.externalUrl,
			lifecycleOutput.externalUrl,
			lifecycleMetadata.externalUrl,
		),
		blockerReason: firstString(
			modeRun.fallbackReason,
			modeOutputs.blockerReason,
			modeOutputMetadata.blockerReason,
			lifecycleOutput.blockerReason,
			lifecycleMetadata.blockerReason,
			assignment.lifecycleReason,
			assignment.lifecycleCode,
		),
		usage: firstArray(
			modeOutputs.usage,
			record(record(modeRun.usageActual).nativeUsage).executionUsage,
			record(modeRun.usageActual).executionUsage,
			lifecycleOutput.usage,
			lifecycleMetadata.usage,
		),
		artifacts: firstArray(
			modeOutputs.artifacts,
			lifecycleOutput.artifacts,
			lifecycleMetadata.artifacts,
		),
		requiredCapabilities: uniqueStrings([
			...stringList(gates.requiredCapabilities),
			...stringList(record(eligibility).requiredCapabilities),
		]),
		preferredCapabilities: uniqueStrings([
			...stringList(gates.preferredCapabilities),
			...stringList(record(eligibility).preferredCapabilities),
		]),
		availableCapabilities: uniqueStrings([
			...stringList(gates.availableCapabilities),
			...stringList(record(eligibility).availableCapabilities),
			...stringList(supply.capabilities),
			...stringList(capabilitySupply.capabilities),
		]),
		aliasCapabilities: uniqueStrings([
			...stringList(gates.aliasCapabilities),
			...stringList(record(eligibility).aliasCapabilities),
			...stringList(supply.aliases),
			...stringList(capabilitySupply.aliases),
		]),
		missingCapabilities: uniqueStrings([
			...stringList(gates.missingCapabilities),
			...stringList(record(eligibility).missingCapabilities),
		]),
		selectedProvider: firstString(
			gates.selectedProvider,
			supply.capacityProviderId,
			capabilitySupply.capacityProviderId,
			assignment.capacityProviderId,
			assignment.providerId,
		),
		selectedExecutionProvider,
		capabilityEligible: visibilityCapabilityEligible({ assignment, explanation, gates }),
		reasonCodes: visibilityReasonCodes({ assignment, explanation, gates }),
		metadata: {
			sources: {
				assignment: Object.keys(assignment).length > 0,
				modeRun: Object.keys(modeRun).length > 0,
				explanation: Object.keys(explanation).length > 0,
			},
		},
	};
}

export function decorateExecutionProviderVisibility<T extends Record<string, unknown>>(
	recordInput: T,
	options: {
		explanation?: Record<string, unknown> | null;
		modeRun?: Record<string, unknown> | null;
	} = {},
): T & { executionVisibility: ExecutionProviderVisibilitySummary } {
	return {
		...recordInput,
		executionVisibility: summarizeExecutionProviderVisibility({
			assignment: options.modeRun ? null : recordInput,
			modeRun: options.modeRun ?? null,
			explanation: options.explanation ?? record(recordInput.explanation),
		}),
	};
}
