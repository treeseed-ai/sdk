import type { AgentModeRun, ProviderAssignment } from '../contracts/capacity/assignments/assignment-records.ts';

export interface AssignmentRecordDiagnostic {
	code: string;
	path: string;
	message: string;
}

const ASSIGNMENT_STATUSES = new Set(['pending', 'leased', 'running', 'completed', 'failed', 'returned', 'expired', 'cancelled']);
const LEASE_STATES = new Set(['unleased', 'leased', 'released', 'expired']);
const MODE_RUN_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
const SYNTHESIS_SOURCES = new Set(['approved_decision', 'planning_input_request', 'capacity_plan', 'workday_demand', 'verification_failure', 'fallback_queue']);

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
	for (const field of ['leaseExpiresAt', 'leaseRenewedAt', 'assignedAt', 'claimedAt', 'completedAt', 'returnedAt', 'failedAt']) {
		if (!optionalTimestamp(assignment[field])) push(diagnostics, 'provider_assignment_timestamp_invalid', field, `${field} must be an ISO timestamp when provided.`);
	}
	for (const field of ['capacityEnvelope', 'decisionInput', 'workspaceContext', 'allowedOutputs', 'explanation', 'lifecycleOutput', 'metadata']) {
		if (!jsonRecord(assignment[field])) push(diagnostics, 'provider_assignment_json_invalid', field, `${field} must be an object.`);
	}
	validateCapacityEnvelope(assignment.capacityEnvelope, 'capacityEnvelope', diagnostics);
	const decisionInput = record(assignment.decisionInput);
	for (const field of ['teamId', 'projectId', 'projectAgentClassId']) {
		if (!present(decisionInput[field])) push(diagnostics, 'decision_execution_input_field_invalid', `decisionInput.${field}`, `${field} is required.`);
	}
	if (decisionInput.mode !== 'planning' && decisionInput.mode !== 'acting') push(diagnostics, 'decision_execution_input_mode_invalid', 'decisionInput.mode', 'mode must be planning or acting.');
	if (!jsonRecord(decisionInput.input)) push(diagnostics, 'decision_execution_input_json_invalid', 'decisionInput.input', 'input must be an object.');
	if (!timestamp(assignment.createdAt)) push(diagnostics, 'provider_assignment_timestamp_invalid', 'createdAt', 'createdAt must be an ISO timestamp.');
	if (!timestamp(assignment.updatedAt)) push(diagnostics, 'provider_assignment_timestamp_invalid', 'updatedAt', 'updatedAt must be an ISO timestamp.');
	return { ok: diagnostics.length === 0, diagnostics };
}

export function assertProviderAssignment(value: unknown): ProviderAssignment {
	const result = validateProviderAssignment(value);
	if (!result.ok) throw new Error(`Invalid provider assignment: ${result.diagnostics.map((entry) => `${entry.code} at ${entry.path}`).join(', ')}`);
	return value as ProviderAssignment;
}

export function validateAgentModeRun(value: unknown) {
	const modeRun = record(value);
	const diagnostics: AssignmentRecordDiagnostic[] = [];
	for (const field of ['id', 'teamId', 'projectId', 'providerAssignmentId', 'capacityProviderId', 'projectAgentClassId', 'createdAt', 'updatedAt']) {
		if (!present(modeRun[field])) push(diagnostics, 'agent_mode_run_field_invalid', field, `${field} is required.`);
	}
	if (modeRun.mode !== 'planning' && modeRun.mode !== 'acting') push(diagnostics, 'agent_mode_run_mode_invalid', 'mode', 'mode must be planning or acting.');
	if (!MODE_RUN_STATUSES.has(String(modeRun.status ?? ''))) push(diagnostics, 'agent_mode_run_status_invalid', 'status', 'status is invalid.');
	for (const field of ['selectedInput', 'capacityEnvelope', 'outputs', 'traceRefs', 'usageActual', 'validation', 'metadata']) {
		if (!jsonRecord(modeRun[field])) push(diagnostics, 'agent_mode_run_json_invalid', field, `${field} must be an object.`);
	}
	validateCapacityEnvelope(modeRun.capacityEnvelope, 'capacityEnvelope', diagnostics);
	for (const field of ['startedAt', 'completedAt', 'failedAt']) {
		if (!optionalTimestamp(modeRun[field])) push(diagnostics, 'agent_mode_run_timestamp_invalid', field, `${field} must be an ISO timestamp when provided.`);
	}
	if (!timestamp(modeRun.createdAt)) push(diagnostics, 'agent_mode_run_timestamp_invalid', 'createdAt', 'createdAt must be an ISO timestamp.');
	if (!timestamp(modeRun.updatedAt)) push(diagnostics, 'agent_mode_run_timestamp_invalid', 'updatedAt', 'updatedAt must be an ISO timestamp.');
	return { ok: diagnostics.length === 0, diagnostics };
}

export function assertAgentModeRun(value: unknown): AgentModeRun {
	const result = validateAgentModeRun(value);
	if (!result.ok) throw new Error(`Invalid agent mode run: ${result.diagnostics.map((entry) => `${entry.code} at ${entry.path}`).join(', ')}`);
	return value as AgentModeRun;
}
