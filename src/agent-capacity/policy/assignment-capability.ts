import type { CapacityLedgerEntry, CapacityReservation, CapacityUsageActual } from '../contracts/financial-records.ts';
import { AGENT_ASSIGNMENT_WORKSPACE_ACCESS_MODES, type AgentAssignmentWorkspaceAccessMode, type AgentCapacityEnvelope, type AgentExecutionMode, type AgentModeRunUsageSettlement, type DecisionExecutionInput, type ProviderAssignment, type ProviderAssignmentCapabilityHandles, type ProviderAssignmentSynthesisSource, type TreeDxProxyHandle, type WorkdayCapacityEnvelope } from '../contracts/assignment-records.ts';
import type { CapacityGrantV2 } from '../allocation.ts';
import type { AgentCapacityPlanRecord, AgentCapacityPlanWorkUnit, DecisionExecutionInputRecord, DecisionPlanningStatus, PlanningInputRequest } from '../contracts/planning-records.ts';
import type { AgentKernelPolicy, AgentKernelProfile, ProjectAgentClass } from '../contracts/project-agent-class.ts';
import type { CapacityExecutionProvider, ProviderAvailabilitySession } from '../../capacity-provider/contracts/index.ts';
import type { AgentRuntimeSpec, AgentWorkPackage, ExecutionCapabilityDemand, ExecutionCapabilitySupply, ExecutionProviderDescriptor, ExecutionResourceNeed } from '../../types/agents.ts';
import type { AgentCapacityPlan, AgentKernelModeDecision, AgentKernelModeExecutionInput, AgentKernelModeFallback, AgentKernelModeFallbackCode, AgentKernelOutputValidationResult, AgentKernelQueueObservation, BuildExecutionProviderAssignmentExplanationInput, CapacityRuntimeBlockerVm, CapacityRuntimeDiagnosticsResponse, CapacitySettlementInvariantResult, CapacitySettlementInvariantViolation, ExecutionCapabilityGateInput, ExecutionProviderEligibilityResult, ExecutionProviderVisibilitySummary, ProviderAssignmentExplanation, ProviderAssignmentSynthesisCandidate, TreeDxProxyAccessRequest, TreeDxProxyAccessResult } from '../contracts/runtime-observability.ts';
import { arrayValue, booleanDefault, booleanOrNull, capabilityHandleArrays, collectSupplyMetadataAliases, collectSupplyMetadataCapabilities, firstArray, firstString, handleResourceNeed, isRecord, numberOrNull, preferredCapabilitiesFromAgent, pressureAllows, pushResourceNeed, record, stableStringify, stringList, stringOrNull, uniqueStrings } from './primitives.ts';
import { createAgentKernelModeFallback } from './mode-primitives.ts';
import { hasAcceptedCapacityPlanProvenance, isDecisionReadyForActing } from './planning.ts';

export function isProviderAssignmentCandidateEligible(candidate: ProviderAssignmentSynthesisCandidate): boolean {
	if (!candidate.teamId || !candidate.projectId || !candidate.capacityProviderId || !candidate.projectAgentClassId) return false;
	if (candidate.mode === 'acting' && candidate.readiness && !isDecisionReadyForActing(candidate.readiness)) return false;
	return candidate.capacityEnvelope.mode === candidate.mode && candidate.decisionInput.mode === candidate.mode;
}

export function validateTreeDxProxyHandle(handle: TreeDxProxyHandle | null | undefined, expected: { teamId?: string | null; projectId: string; assignmentId?: string | null }): AgentKernelModeFallback | null {
	if (!handle) return null;
	if (!handle.id && !handle.projectId) return null;
	const access = evaluateTreeDxProxyHandleAccess(handle, {
		teamId: expected.teamId ?? null,
		projectId: expected.projectId,
		assignmentId: expected.assignmentId ?? null,
	});
	if (!access.ok) {
		return createAgentKernelModeFallback(
			'assignment_treedx_proxy_scope_invalid',
			access.reason ?? 'TreeDX proxy handle scope does not match the assignment.',
			{ retryable: access.code === 'treedx_proxy_handle_expired', metadata: access.metadata },
		);
	}
	return null;
}

function hasSecretLikeKey(key: string): boolean {
	return /(^|[_-])(plaintext|token|passphrase|password|private[_-]?key|deploy[_-]?key|raw[_-]?secret|unencrypted|credential)([_-]|$)/iu.test(key)
		|| ['secretValue', 'rawSecret', 'githubInstallationToken', 'deployKey', 'privateKey'].includes(key);
}

function findSecretLikePath(value: unknown, path = '$'): string | null {
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			const found = findSecretLikePath(value[index], `${path}[${index}]`);
			if (found) return found;
		}
		return null;
	}
	if (!isRecord(value)) return null;
	for (const [key, entry] of Object.entries(value)) {
		const nextPath = `${path}.${key}`;
		if (hasSecretLikeKey(key)) return nextPath;
		const found = findSecretLikePath(entry, nextPath);
		if (found) return found;
	}
	return null;
}

function normalizeWorkspaceAccessMode(value: unknown): AgentAssignmentWorkspaceAccessMode {
	return AGENT_ASSIGNMENT_WORKSPACE_ACCESS_MODES.includes(value as AgentAssignmentWorkspaceAccessMode)
		? value as AgentAssignmentWorkspaceAccessMode
		: 'context_only';
}

function planningContentArtifactWriteAllowed(input: {
	assignment: Pick<ProviderAssignment, 'mode' | 'metadata' | 'synthesizedFrom'>;
	handle: ProviderAssignmentCapabilityHandle;
	operations: string[];
}) {
	if (input.assignment.mode !== 'planning') return false;
	const metadata = record(input.assignment.metadata);
	if (metadata.allowPlanningContentArtifacts !== true) return false;
	const handle = record(input.handle);
	const contentProxyHandle = input.handle.kind === 'treedx_workspace'
		|| (input.handle.kind === 'repository_access' && handle.provider === 'treedx_proxy' && handle.credentialMode === 'brokered');
	if (!contentProxyHandle) return false;
	const allowed = new Set(['read', 'write', 'commit', 'test', 'files:read', 'files:search', 'files:write', 'git:commit', 'workspace:write']);
	return input.operations.every((operation) => allowed.has(operation));
}

export function redactedProviderAssignmentCapabilityHandles(
	handles: ProviderAssignmentCapabilityHandles | Record<string, unknown> | null | undefined,
): ProviderAssignmentCapabilityHandles {
	const source = record(handles);
	const redact = (handle: unknown) => {
		const next = { ...record(handle) };
		for (const key of Object.keys(next)) {
			if (hasSecretLikeKey(key)) delete next[key];
		}
		return next as ProviderAssignmentCapabilityHandle;
	};
	return {
		workspaceAccessMode: normalizeWorkspaceAccessMode(source.workspaceAccessMode),
		repository: arrayValue(source.repository).map(redact) as ProviderRepositoryAccessHandle[],
		treeDx: arrayValue(source.treeDx).map(redact) as ProviderTreeDxWorkspaceHandle[],
		workflowOperations: arrayValue(source.workflowOperations).map(redact) as ProviderWorkflowOperationHandle[],
		secrets: arrayValue(source.secrets).map(redact) as ProviderSecretUseHandle[],
		metadata: record(source.metadata),
	};
}

export function providerAssignmentCapabilityHandlesContainSecretMaterial(value: unknown): boolean {
	return Boolean(findSecretLikePath(value));
}

export function validateProviderAssignmentCapabilityHandles(input: {
	assignment: Pick<ProviderAssignment, 'id' | 'teamId' | 'projectId' | 'mode' | 'metadata' | 'decisionInput' | 'capacityEnvelope' | 'synthesizedFrom'> & {
		capabilityHandles?: ProviderAssignmentCapabilityHandles | Record<string, unknown> | null;
	};
	capabilityHandles?: ProviderAssignmentCapabilityHandles | Record<string, unknown> | null;
	decisionInput?: DecisionExecutionInput | null;
	capacityEnvelope?: AgentCapacityEnvelope | null;
	now?: Date;
}): AgentKernelModeFallback | null {
	const assignment = input.assignment;
	const handles = input.capabilityHandles ?? assignment.capabilityHandles ?? null;
	if (!handles) return null;
	const leakedPath = findSecretLikePath(handles);
	if (leakedPath) {
		return createAgentKernelModeFallback(
			'assignment_capability_handle_secret_material',
			`Assignment ${assignment.id} capability handles include secret-like material at ${leakedPath}.`,
			{ retryable: false, metadata: { path: leakedPath } },
		);
	}
	const workspaceAccessMode = normalizeWorkspaceAccessMode(record(handles).workspaceAccessMode);
	const governedBaseRef = stringOrNull(record(record(assignment.decisionInput).input).exactBaseRef);
	const allHandles = capabilityHandleArrays(handles);
	for (const handle of allHandles) {
		if (!handle.id || !handle.kind) {
			return createAgentKernelModeFallback(
				'assignment_capability_handle_invalid',
				`Assignment ${assignment.id} has an invalid capability handle.`,
				{ retryable: false },
			);
		}
		if ((handle.teamId && handle.teamId !== assignment.teamId) || (handle.projectId && handle.projectId !== assignment.projectId) || (handle.assignmentId && handle.assignmentId !== assignment.id)) {
			return createAgentKernelModeFallback(
				'assignment_capability_handle_invalid',
				`Assignment ${assignment.id} capability handle ${handle.id} is scoped to a different assignment.`,
				{ retryable: false, metadata: { handleId: handle.id, kind: handle.kind } },
			);
		}
		if (handle.expiresAt && Date.parse(handle.expiresAt) <= (input.now ?? new Date()).getTime()) {
			return createAgentKernelModeFallback(
				'assignment_capability_handle_invalid',
				`Assignment ${assignment.id} capability handle ${handle.id} has expired.`,
				{ retryable: true, metadata: { handleId: handle.id, kind: handle.kind } },
			);
		}
		const operations = stringList(handle.operations);
		const writeCapable = operations.some((operation) => ['write', 'commit', 'push', 'release', 'dispatch_workflow', 'files:write', 'git:commit'].includes(operation));
		const planningContentWrite = writeCapable && planningContentArtifactWriteAllowed({ assignment, handle, operations });
		if (writeCapable && assignment.mode !== 'acting' && !planningContentWrite) {
			return createAgentKernelModeFallback(
				'assignment_capability_handle_write_not_ready',
				`Assignment ${assignment.id} cannot receive write-capable capability handles outside acting mode.`,
				{ retryable: false, metadata: { handleId: handle.id, kind: handle.kind, operations } },
			);
		}
		if (writeCapable && !planningContentWrite && !hasAcceptedCapacityPlanProvenance({
			assignment,
			decisionInput: input.decisionInput ?? null,
			capacityEnvelope: input.capacityEnvelope ?? null,
		})) {
			return createAgentKernelModeFallback(
				'assignment_capability_handle_write_not_ready',
				`Assignment ${assignment.id} write-capable capability handles require accepted capacity-plan provenance.`,
				{ retryable: true, metadata: { handleId: handle.id, kind: handle.kind } },
			);
		}
		if (workspaceAccessMode === 'context_only' && writeCapable) {
			return createAgentKernelModeFallback(
				'assignment_capability_handle_workspace_denied',
				`Assignment ${assignment.id} context-only workspace mode cannot receive write-capable handles.`,
				{ retryable: false, metadata: { handleId: handle.id, kind: handle.kind } },
			);
		}
		if (handle.kind === 'repository_access' && governedBaseRef && writeCapable) {
			const allowedRefs = stringList(handle.allowedRefs);
			if (allowedRefs.length !== 1 || allowedRefs[0] !== governedBaseRef) {
				return createAgentKernelModeFallback(
					'assignment_repository_ref_scope_invalid',
					`Assignment ${assignment.id} repository handle ${handle.id} is not bound to its governed exact base ref.`,
					{ retryable: false, metadata: { handleId: handle.id, governedBaseRef, allowedRefs } },
				);
			}
		}
		if (handle.kind === 'workflow_operation') {
			const workflow = handle as ProviderWorkflowOperationHandle;
			if (!workflow.operationId || !workflow.repository || !workflow.workflowFile) {
				return createAgentKernelModeFallback(
					'assignment_workflow_operation_denied',
					`Assignment ${assignment.id} workflow operation handle ${handle.id} is missing operation scope.`,
					{ retryable: false, metadata: { handleId: handle.id } },
				);
			}
			if (!operations.includes('dispatch_workflow')) {
				return createAgentKernelModeFallback(
					'assignment_workflow_operation_denied',
					`Assignment ${assignment.id} workflow operation handle ${handle.id} is not dispatch-capable.`,
					{ retryable: false, metadata: { handleId: handle.id } },
				);
			}
		}
	}
	return null;
}

function globLikePathMatches(pattern: string, candidate: string): boolean {
	const normalizedPattern = pattern.replace(/^\/+/, '');
	const normalizedCandidate = candidate.replace(/^\/+/, '');
	if (!normalizedPattern || normalizedPattern === '**' || normalizedPattern === '*') return true;
	if (normalizedPattern.endsWith('/**')) {
		const prefix = normalizedPattern.slice(0, -3);
		return normalizedCandidate === prefix || normalizedCandidate.startsWith(`${prefix}/`);
	}
	if (normalizedPattern.endsWith('*')) {
		return normalizedCandidate.startsWith(normalizedPattern.slice(0, -1));
	}
	return normalizedCandidate === normalizedPattern || normalizedCandidate.startsWith(`${normalizedPattern}/`);
}

export function evaluateTreeDxProxyHandleAccess(handle: TreeDxProxyHandle | Record<string, unknown> | null | undefined, request: TreeDxProxyAccessRequest): TreeDxProxyAccessResult {
	const candidate = record(handle);
	if (!candidate.id) return { ok: false, code: 'treedx_proxy_handle_missing', reason: 'TreeDX proxy handle is required.' };
	if (candidate.status === 'revoked' || candidate.revokedAt) return { ok: false, code: 'treedx_proxy_handle_revoked', reason: 'TreeDX proxy handle has been revoked.' };
	if (candidate.status === 'expired') return { ok: false, code: 'treedx_proxy_handle_expired', reason: 'TreeDX proxy handle has expired.' };
	if (String(candidate.projectId ?? '') !== request.projectId || (request.teamId && String(candidate.teamId ?? '') !== request.teamId)) {
		return { ok: false, code: 'treedx_proxy_scope_mismatch', reason: 'TreeDX proxy handle scope does not match the project.', metadata: { projectId: request.projectId, handleProjectId: candidate.projectId } };
	}
	if (request.assignmentId && candidate.assignmentId && String(candidate.assignmentId) !== request.assignmentId) {
		return { ok: false, code: 'treedx_proxy_assignment_mismatch', reason: 'TreeDX proxy handle is bound to a different assignment.', metadata: { assignmentId: request.assignmentId, handleAssignmentId: candidate.assignmentId } };
	}
	if (request.repositoryId && candidate.repositoryId && String(candidate.repositoryId) !== request.repositoryId) {
		return { ok: false, code: 'treedx_proxy_repository_mismatch', reason: 'TreeDX proxy handle is bound to a different repository.', metadata: { repositoryId: request.repositoryId, handleRepositoryId: candidate.repositoryId } };
	}
	if (request.workspaceId && candidate.workspaceId && String(candidate.workspaceId) !== request.workspaceId) {
		return { ok: false, code: 'treedx_proxy_workspace_mismatch', reason: 'TreeDX proxy handle is bound to a different workspace.', metadata: { workspaceId: request.workspaceId, handleWorkspaceId: candidate.workspaceId } };
	}
	if (candidate.expiresAt && Date.parse(String(candidate.expiresAt)) <= (request.now ?? new Date()).getTime()) {
		return { ok: false, code: 'treedx_proxy_handle_expired', reason: 'TreeDX proxy handle has expired.' };
	}
	if (candidate.token && request.token && String(candidate.token) !== request.token) {
		return { ok: false, code: 'treedx_proxy_token_mismatch', reason: 'TreeDX proxy handle token does not match.' };
	}
	const operation = request.operation ? String(request.operation) : null;
	const allowedOperations = Array.isArray(candidate.allowedOperations) ? candidate.allowedOperations.map(String) : [];
	if (operation && allowedOperations.length && !allowedOperations.includes(operation) && !allowedOperations.includes('*')) {
		return { ok: false, code: 'treedx_proxy_operation_denied', reason: 'TreeDX proxy handle does not allow this operation.', metadata: { operation, allowedOperations } };
	}
	const path = request.path ? String(request.path).replace(/^\/+/, '') : null;
	const writeOperation = operation === 'files:write' || operation === 'git:commit';
	const readPaths = Array.isArray(candidate.allowedReadPaths) ? candidate.allowedReadPaths.map(String).filter(Boolean) : [];
	const writePaths = Array.isArray(candidate.allowedWritePaths) ? candidate.allowedWritePaths.map(String).filter(Boolean) : [];
	const fallbackPaths = Array.isArray(candidate.allowedPaths) ? candidate.allowedPaths.map(String).filter(Boolean) : [];
	const allowedPaths = writeOperation
		? (writePaths.length ? writePaths : fallbackPaths)
		: (readPaths.length ? readPaths : fallbackPaths);
	if (path && allowedPaths.length && !allowedPaths.some((pattern) => globLikePathMatches(pattern, path))) {
		return { ok: false, code: 'treedx_proxy_path_denied', reason: 'TreeDX proxy handle does not allow this path.', metadata: { path, allowedPaths } };
	}
	return { ok: true };
}
