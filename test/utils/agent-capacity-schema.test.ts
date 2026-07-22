import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	agentFallbackOutputs,
	agentModeRuns,
	agentCapacityPlans,
	capacityExecutionProviders,
	capacityProviderLanes,
	capacityReservationCounterClaims,
	capacityLedgerEntries,
	capacityOperationReceipts,
	capacityReservations,
	decisionAssignmentGraphs,
	researchWorkflows,
	deliverableContracts,
	deliverableManifests,
	capacityProviderAssignments,
	structuredAgentEstimates,
	capacityUsageActuals,
	capacityWorkdayDemands,
	capacityWorkdayParticipationCycles,
	capacityWorkdayParticipationEntries,
	treeDxProjectProxyAudit,
	treeDxProxyHandles,
	workdayCapacityEnvelopes,
} from '../../src/db/market-schema.ts';

function tableName(table: unknown) {
	return (table as { [key: symbol]: string })[Symbol.for('drizzle:Name')];
}

describe('agent capacity market schema', () => {
	it('exports every durable runtime evidence table used by capacity diagnostics', () => {
		expect(tableName(capacityProviderAssignments)).toBe('capacity_provider_assignments');
		expect(tableName(capacityExecutionProviders)).toBe('capacity_execution_providers');
		expect(tableName(capacityProviderLanes)).toBe('capacity_provider_lanes');
		expect(tableName(agentModeRuns)).toBe('agent_mode_runs');
		expect(tableName(agentFallbackOutputs)).toBe('agent_fallback_outputs');
		expect(tableName(treeDxProjectProxyAudit)).toBe('treedx_project_proxy_audit');
		expect(tableName(capacityReservations)).toBe('capacity_reservations');
		expect(tableName(capacityUsageActuals)).toBe('capacity_usage_actuals');
		expect(tableName(capacityLedgerEntries)).toBe('capacity_ledger_entries');
		expect(tableName(capacityOperationReceipts)).toBe('capacity_operation_receipts');
		expect(tableName(capacityWorkdayDemands)).toBe('capacity_workday_demands');
		expect(tableName(capacityWorkdayParticipationCycles)).toBe('capacity_workday_participation_cycles');
		expect(tableName(capacityWorkdayParticipationEntries)).toBe('capacity_workday_participation_entries');
		expect(tableName(researchWorkflows)).toBe('research_workflows');
	});

	it('keeps the fallback output persistence contract aligned with the public model', () => {
		for (const field of [
			'id',
			'teamId',
			'projectId',
			'assignmentId',
			'mode',
			'code',
			'status',
			'outputJson',
			'provenanceJson',
			'quotaJson',
			'metadataJson',
			'createdAt',
		]) {
			expect(agentFallbackOutputs).toHaveProperty(field);
		}
	});

	it('persists explicit admission and settlement transaction ownership', () => {
		expect(capacityReservations).toHaveProperty('admissionToken');
		expect(capacityReservations).toHaveProperty('settlementToken');
		expect(capacityReservationCounterClaims).toHaveProperty('admissionToken');
		expect(capacityUsageActuals).toHaveProperty('idempotencyKey');
		expect(capacityUsageActuals).toHaveProperty('assignmentAttempt');
		expect(capacityUsageActuals).toHaveProperty('usageDimension');
	});

	it('uses one clean baseline with no capacity compatibility migrations', () => {
		const migrationDirectory = resolve(process.cwd(), 'drizzle/market');
		expect(readdirSync(migrationDirectory).filter((file) => file.endsWith('.sql'))).toEqual(['0000_market_control_plane.sql']);
		const baseline = readFileSync(resolve(migrationDirectory, '0000_market_control_plane.sql'), 'utf8');
		expect(baseline).toContain('"workday_run_id" text');
		expect(baseline).toContain('"admission_token" text NOT NULL');
		expect(baseline).toContain('"settlement_token" text');
		expect(baseline).toContain('"usage_report_token" text');
		expect(baseline).toContain('CREATE TABLE "agent_fallback_outputs"');
		expect(baseline).toContain('idx_capacity_ledger_reservation_phase');
		expect(baseline).toContain('idx_capacity_usage_actuals_idempotency');
		expect(baseline).toContain('idx_capacity_usage_actuals_attempt_dimension');
		expect(baseline).toContain('idx_capacity_operation_receipts_idempotency');
		expect(baseline).toContain('fk_capacity_operation_receipts_team');
		expect(baseline).toContain('chk_capacity_usage_actuals_accounting_mode');
		expect(baseline).toContain('chk_capacity_usage_actuals_assignment_attempt');
		expect(baseline).toContain('chk_workday_capacity_envelopes_status');
		expect(baseline).toContain('chk_agent_capacity_plans_status');
		expect(baseline).toContain('chk_agent_capacity_plans_credits');
		expect(baseline).toContain('chk_decision_planning_statuses_readiness');
		expect(baseline).toContain('chk_planning_input_requests_status');
		expect(baseline).toContain('chk_decision_execution_inputs_status');
		expect(baseline).toContain('work_graph_node_id');
		expect(baseline).toContain('idx_decision_execution_inputs_graph_scope');
		expect(baseline).toContain('chk_capacity_workday_demands_credits');
		expect(baseline).toContain('idx_capacity_workday_demands_idempotency');
		expect(baseline).toContain('idx_capacity_workday_participation_cycles_number');
		expect(baseline).toContain('idx_capacity_workday_participation_entries_agent');
		expect(baseline).toContain('CREATE TABLE "research_workflows"');
		expect(baseline).toContain('idx_research_workflows_idempotency');
		expect(baseline).toContain("'research-workflow'");
	});

	it('deletes team-owned capacity history only at the explicit team aggregate boundary', () => {
		const baseline = readFileSync(resolve(process.cwd(), 'drizzle/market/0000_market_control_plane.sql'), 'utf8');
		for (const constraint of [
			'fk_agent_fallback_outputs_team',
			'fk_agent_mode_runs_team',
			'fk_capacity_ledger_team',
			'fk_capacity_provider_assignments_team',
			'fk_capacity_reservations_team',
			'fk_capacity_usage_actuals_assignment',
			'fk_capacity_usage_actuals_mode_run',
			'fk_capacity_usage_actuals_project',
			'fk_capacity_workday_demands_team',
			'fk_capacity_workday_events_team',
			'fk_capacity_workday_participation_cycles_team',
			'fk_capacity_workday_participation_entries_team',
			'fk_capacity_workday_runs_team',
			'fk_research_workflows_team',
			'fk_workday_capacity_envelopes_team',
		]) {
			const statement = baseline.split('\n').find((line) => line.includes(`"${constraint}"`));
			expect(statement, constraint).toContain('ON DELETE cascade');
		}
	});

	it('constrains workday and capacity-plan governance provenance', () => {
		for (const retiredPolicyColumn of ['modeSplitsJson', 'capsJson', 'reservesJson', 'borrowingRulesJson']) {
			expect(workdayCapacityEnvelopes).not.toHaveProperty(retiredPolicyColumn);
		}
		const baseline = readFileSync(resolve(process.cwd(), 'drizzle/market/0000_market_control_plane.sql'), 'utf8');
		for (const retiredPolicyColumn of ['mode_splits_json', 'caps_json', 'reserves_json', 'borrowing_rules_json']) {
			const workdayTable = baseline.slice(baseline.indexOf('CREATE TABLE "workday_capacity_envelopes"'), baseline.indexOf('CREATE TABLE "workflow_dispatch_records"'));
			expect(workdayTable).not.toContain(retiredPolicyColumn);
		}
		expect(tableName(agentCapacityPlans)).toBe('agent_capacity_plans');
		expect(agentCapacityPlans).toHaveProperty('teamId');
		expect(agentCapacityPlans).toHaveProperty('projectId');
		expect(agentCapacityPlans).toHaveProperty('allocationSetId');
		expect(agentCapacityPlans).toHaveProperty('workDayId');
	});

	it('persists distinct TreeDX read and write path scopes', () => {
		expect(tableName(treeDxProxyHandles)).toBe('treedx_proxy_handles');
		expect(treeDxProxyHandles).toHaveProperty('allowedReadPathsJson');
		expect(treeDxProxyHandles).toHaveProperty('allowedWritePathsJson');
	});

	it('owns the complete decision graph and deliverable persistence contract', () => {
		expect(tableName(structuredAgentEstimates)).toBe('structured_agent_estimates');
		expect(tableName(decisionAssignmentGraphs)).toBe('decision_assignment_graphs');
		expect(tableName(deliverableContracts)).toBe('deliverable_contracts');
		expect(tableName(deliverableManifests)).toBe('deliverable_manifests');
		expect(decisionAssignmentGraphs).toHaveProperty('graphJson');
		expect(deliverableManifests).toHaveProperty('deliverableContractId');

		const baseline = readFileSync(resolve(process.cwd(), 'drizzle/market/0000_market_control_plane.sql'), 'utf8');
		for (const table of [
			'structured_agent_estimates',
			'decision_assignment_graphs',
			'deliverable_contracts',
			'deliverable_manifests',
		]) expect(baseline).toContain(`CREATE TABLE "${table}"`);
	});

	it('does not regenerate retired project-runner execution or coordination tables', () => {
		const baseline = readFileSync(resolve(process.cwd(), 'drizzle/market/0000_market_control_plane.sql'), 'utf8');
		for (const table of [
			'runtime_tasks',
			'runtime_task_events',
			'runtime_task_outputs',
			'workday_manager_leases',
			'worker_runners',
			'repository_claims',
			'runner_scale_decisions',
			'agent_pools',
			'agent_pool_registrations',
			'agent_pool_scale_decisions',
			'scale_decisions',
			'work_days',
			'graph_runs',
			'reports',
			'project_workday_summaries',
			'work_policies',
			'workday_requests',
			'priority_overrides',
			'priority_snapshots',
			'task_credit_ledger',
		]) {
			expect(baseline).not.toContain(`CREATE TABLE "${table}"`);
		}
	});

	it('contains only canonical capacity entity names', () => {
		const baseline = readFileSync(resolve(process.cwd(), 'drizzle/market/0000_market_control_plane.sql'), 'utf8');
		for (const table of [
			'capacity_execution_providers',
			'capacity_provider_lanes',
			'capacity_provider_assignments',
			'capacity_usage_actuals',
		]) expect(baseline).toContain(`CREATE TABLE "${table}"`);
		for (const legacy of [
			'provider_assignments',
			'task_usage_actuals',
			'native_usage_observations',
			'capacity_provider_api_keys',
			'capacity_provider_live_registrations',
		]) expect(baseline).not.toContain(`CREATE TABLE "${legacy}"`);
	});
});
