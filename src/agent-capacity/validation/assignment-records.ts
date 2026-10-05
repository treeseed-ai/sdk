import type { ProviderAssignment } from '../contracts/capacity/assignments/assignment-records.ts';

export interface AssignmentRecordDiagnostic {
	code: string;
	path: string;
	message: string;
}

const ASSIGNMENT_STATUSES = new Set(['pending', 'leased', 'running', 'completed', 'failed', 'returned', 'expired', 'cancelled']);
const LEASE_STATES = new Set(['unleased', 'leased', 'released', 'expired']);
const SYNTHESIS_SOURCES = new Set(['living_execution_graph']);

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function present(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function timestamp(value: unknown): boolean {
	return present(value) && Number.isFinite(Date.parse(value));
}

function optionalTimestamp(value: unknown): boolean {
	return value == null || value === '' || timestamp(value);
}

function jsonRecord(value: unknown): boolean {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function push(diagnostics: AssignmentRecordDiagnostic[], code: string, path: string, message: string) {
	diagnostics.push({ code, path, message });
}

function validateCapacityEnvelope(value: unknown, path: string, diagnostics: AssignmentRecordDiagnostic[]) {
	const envelope = record(value);
	if (!present(envelope.teamId)) push(diagnostics, 'agent_capacity_envelope_field_invalid', `${path}.teamId`, 'teamId is required.');
	if (!present(envelope.projectId)) push(diagnostics, 'agent_capacity_envelope_field_invalid', `${path}.projectId`, 'projectId is required.');
	if (envelope.mode !== 'planning' && envelope.mode !== 'acting') push(diagnostics, 'agent_capacity_envelope_mode_invalid', `${path}.mode`, 'mode must be planning or acting.');
}

export function validateProviderAssignment(value: unknown) {
	const assignment = record(value);
	const diagnostics: AssignmentRecordDiagnostic[] = [];
	for (const field of ['id', 'membershipId', 'teamId', 'projectId', 'capacityProviderId', 'projectAgentClassId', 'createdAt', 'updatedAt']) {
		if (!present(assignment[field])) push(diagnostics, 'provider_assignment_field_invalid', field, `${field} is required.`);
	}
	if (!Number.isInteger(assignment.stateVersion) || Number(assignment.stateVersion) < 1) push(diagnostics, 'provider_assignment_state_version_invalid', 'stateVersion', 'stateVersion must be a positive integer.');
	if (assignment.mode !== 'planning' && assignment.mode !== 'acting') push(diagnostics, 'provider_assignment_mode_invalid', 'mode', 'mode must be planning or acting.');
	if (!ASSIGNMENT_STATUSES.has(String(assignment.status ?? ''))) push(diagnostics, 'provider_assignment_status_invalid', 'status', 'status is invalid.');
	if (!LEASE_STATES.has(String(assignment.leaseState ?? ''))) push(diagnostics, 'provider_assignment_lease_state_invalid', 'leaseState', 'leaseState is invalid.');
	if (!Number.isInteger(assignment.attemptCount) || Number(assignment.attemptCount) < 0) push(diagnostics, 'provider_assignment_attempt_count_invalid', 'attemptCount', 'attemptCount must be a nonnegative integer.');
	if (assignment.synthesizedFrom != null && !SYNTHESIS_SOURCES.has(String(assignment.synthesizedFrom))) push(diagnostics, 'provider_assignment_synthesis_source_invalid', 'synthesizedFrom', 'synthesizedFrom is invalid.');
	if (Object.hasOwn(assignment, 'decisionInput')) push(diagnostics, 'provider_assignment_retired_input', 'decisionInput', 'Use the immutable assignmentAttempt instead.');
	if (Object.hasOwn(assignment, 'allocationSetId')) push(diagnostics, 'provider_assignment_retired_allocation', 'allocationSetId', 'Use the living-graph reservation instead.');
	for (const field of ['leaseExpiresAt', 'leaseRenewedAt', 'assignedAt', 'claimedAt', 'completedAt', 'returnedAt', 'failedAt']) {
		if (!optionalTimestamp(assignment[field])) push(diagnostics, 'provider_assignment_timestamp_invalid', field, `${field} must be an ISO timestamp when provided.`);
	}
	for (const field of ['capacityEnvelope', 'workspaceContext', 'allowedOutputs', 'explanation', 'lifecycleOutput', 'metadata']) {
		if (!jsonRecord(assignment[field])) push(diagnostics, 'provider_assignment_json_invalid', field, `${field} must be an object.`);
	}
	validateCapacityEnvelope(assignment.capacityEnvelope, 'capacityEnvelope', diagnostics);
	if (!timestamp(assignment.createdAt)) push(diagnostics, 'provider_assignment_timestamp_invalid', 'createdAt', 'createdAt must be an ISO timestamp.');
	if (!timestamp(assignment.updatedAt)) push(diagnostics, 'provider_assignment_timestamp_invalid', 'updatedAt', 'updatedAt must be an ISO timestamp.');
	return { ok: diagnostics.length === 0, diagnostics };
}

export function assertProviderAssignment(value: unknown): ProviderAssignment {
	const result = validateProviderAssignment(value);
	if (!result.ok) throw new Error(`Invalid provider assignment: ${result.diagnostics.map((entry) => `${entry.code} at ${entry.path}`).join(', ')}`);
	return value as ProviderAssignment;
}
