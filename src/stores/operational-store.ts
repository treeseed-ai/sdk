import crypto from 'node:crypto';
import type {
	AgentPoolAutoscalePolicy,
	ApprovalRequest,
	CreateApprovalRequestRequest,
	DecideApprovalRequestRequest,
	PrioritySnapshot,
	ListApprovalRequestsRequest,
	SdkCreatePrioritySnapshotRequest,
	SdkAppendTaskEventRequest,
	SdkClaimTaskRequest,
	SdkCloseWorkDayRequest,
	SdkCompleteTaskRequest,
	SdkCreateReportRequest,
	SdkCreateTaskRequest,
	SdkFailTaskRequest,
	SdkGraphRunEntity,
	SdkClaimWorkdayManagerLeaseRequest,
	SdkCreateWorkdayRequest,
	SdkPriorityOverrideRequest,
	SdkRecordRepositoryClaimRequest,
	SdkRecordRunnerScaleDecisionRequest,
	SdkReportEntity,
	SdkRecordScaleDecisionRequest,
	SdkRecordWorkerRunnerRequest,
	SdkRecordTaskCreditsRequest,
	SdkReleaseWorkdayManagerLeaseRequest,
	SdkStartWorkDayRequest,
	SdkTaskEntity,
	SdkTaskEventEntity,
	SdkTaskOutputEntity,
	SdkTaskProgressRequest,
	SdkTaskSearchRequest,
	SdkUpsertWorkPolicyRequest,
	SdkUpdateWorkDayGraphRequest,
	SdkWorkDayEntity,
	RepositoryClaim,
	RunnerScaleDecision,
	ScaleDecision,
	TaskCreditLedgerEntry,
	TaskCreditWeight,
	UpsertTeamInboxItemRequest,
	WorkdayPolicy,
	WorkdayManagerLease,
	WorkdayRequest,
	WorkerRunner,
	WorkdaySchedule,
} from '../sdk-types.ts';
import type { InboxItem } from '../project-workflow.ts';
import { SqliteStoreBase, nowIso, toSqlValue, type DatabaseRow } from './helpers.ts';

function json(value: unknown) {
	return JSON.stringify(value ?? {});
}

function workDayFromRow(row: DatabaseRow): SdkWorkDayEntity {
	return {
		id: String(row.id ?? ''),
		projectId: String(row.project_id ?? row.projectId ?? ''),
		state: String(row.state ?? 'active'),
		capacityBudget: Number(row.capacity_budget ?? row.capacityBudget ?? 0),
		capacityUsed: Number(row.capacity_used ?? row.capacityUsed ?? 0),
		graphVersion:
			row.graph_version !== undefined && row.graph_version !== null
				? String(row.graph_version)
				: row.graphVersion !== undefined && row.graphVersion !== null
					? String(row.graphVersion)
					: null,
		summaryJson:
			row.summary_json !== undefined && row.summary_json !== null
				? String(row.summary_json)
				: row.summaryJson !== undefined && row.summaryJson !== null
					? String(row.summaryJson)
					: null,
		startedAt: String(row.started_at ?? row.startedAt ?? nowIso()),
		endedAt:
			row.ended_at !== undefined && row.ended_at !== null
				? String(row.ended_at)
				: row.endedAt !== undefined && row.endedAt !== null
					? String(row.endedAt)
					: null,
		createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
		updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
	};
}

function taskFromRow(row: DatabaseRow): SdkTaskEntity {
	return {
		id: String(row.id ?? ''),
		workDayId: String(row.work_day_id ?? row.workDayId ?? ''),
		agentId: String(row.agent_id ?? row.agentId ?? ''),
		type: String(row.type ?? ''),
		state: String(row.state ?? 'pending'),
		priority: Number(row.priority ?? 0),
		idempotencyKey: String(row.idempotency_key ?? row.idempotencyKey ?? ''),
		payloadJson: String(row.payload_json ?? row.payloadJson ?? '{}'),
		payloadHash:
			row.payload_hash !== undefined && row.payload_hash !== null
				? String(row.payload_hash)
				: row.payloadHash !== undefined && row.payloadHash !== null
					? String(row.payloadHash)
					: null,
		attemptCount: Number(row.attempt_count ?? row.attemptCount ?? 0),
		maxAttempts: Number(row.max_attempts ?? row.maxAttempts ?? 3),
		claimedBy:
			row.claimed_by !== undefined && row.claimed_by !== null
				? String(row.claimed_by)
				: row.claimedBy !== undefined && row.claimedBy !== null
					? String(row.claimedBy)
					: null,
		leaseExpiresAt:
			row.lease_expires_at !== undefined && row.lease_expires_at !== null
				? String(row.lease_expires_at)
				: row.leaseExpiresAt !== undefined && row.leaseExpiresAt !== null
					? String(row.leaseExpiresAt)
					: null,
		availableAt: String(row.available_at ?? row.availableAt ?? nowIso()),
		lastErrorCode:
			row.last_error_code !== undefined && row.last_error_code !== null
				? String(row.last_error_code)
				: row.lastErrorCode !== undefined && row.lastErrorCode !== null
					? String(row.lastErrorCode)
					: null,
		lastErrorMessage:
			row.last_error_message !== undefined && row.last_error_message !== null
				? String(row.last_error_message)
				: row.lastErrorMessage !== undefined && row.lastErrorMessage !== null
					? String(row.lastErrorMessage)
					: null,
		graphVersion:
			row.graph_version !== undefined && row.graph_version !== null
				? String(row.graph_version)
				: row.graphVersion !== undefined && row.graphVersion !== null
					? String(row.graphVersion)
					: null,
		parentTaskId:
			row.parent_task_id !== undefined && row.parent_task_id !== null
				? String(row.parent_task_id)
				: row.parentTaskId !== undefined && row.parentTaskId !== null
					? String(row.parentTaskId)
					: null,
		createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
		startedAt:
			row.started_at !== undefined && row.started_at !== null
				? String(row.started_at)
				: row.startedAt !== undefined && row.startedAt !== null
					? String(row.startedAt)
					: null,
		completedAt:
			row.completed_at !== undefined && row.completed_at !== null
				? String(row.completed_at)
				: row.completedAt !== undefined && row.completedAt !== null
					? String(row.completedAt)
					: null,
		updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
	};
}

function taskEventFromRow(row: DatabaseRow): SdkTaskEventEntity {
	return {
		id: String(row.id ?? ''),
		taskId: String(row.task_id ?? row.taskId ?? ''),
		seq: Number(row.seq ?? 0),
		kind: String(row.kind ?? ''),
		dataJson: String(row.data_json ?? row.dataJson ?? '{}'),
		createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
	};
}

function taskOutputFromRow(row: DatabaseRow): SdkTaskOutputEntity {
	return {
		id: String(row.id ?? ''),
		taskId: String(row.task_id ?? row.taskId ?? ''),
		outputJson: String(row.output_json ?? row.outputJson ?? '{}'),
		outputRef:
			row.output_ref !== undefined && row.output_ref !== null
				? String(row.output_ref)
				: row.outputRef !== undefined && row.outputRef !== null
					? String(row.outputRef)
					: null,
		createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
	};
}

function graphRunFromRow(row: DatabaseRow): SdkGraphRunEntity {
	return {
		id: String(row.id ?? ''),
		workDayId: String(row.work_day_id ?? row.workDayId ?? ''),
		corpusHash: String(row.corpus_hash ?? row.corpusHash ?? ''),
		graphVersion: String(row.graph_version ?? row.graphVersion ?? ''),
		queryJson:
			row.query_json !== undefined && row.query_json !== null
				? String(row.query_json)
				: row.queryJson !== undefined && row.queryJson !== null
					? String(row.queryJson)
					: null,
		seedIdsJson:
			row.seed_ids_json !== undefined && row.seed_ids_json !== null
				? String(row.seed_ids_json)
				: row.seedIdsJson !== undefined && row.seedIdsJson !== null
					? String(row.seedIdsJson)
					: null,
		selectedNodeIdsJson:
			row.selected_node_ids_json !== undefined && row.selected_node_ids_json !== null
				? String(row.selected_node_ids_json)
				: row.selectedNodeIdsJson !== undefined && row.selectedNodeIdsJson !== null
					? String(row.selectedNodeIdsJson)
					: null,
		statsJson:
			row.stats_json !== undefined && row.stats_json !== null
				? String(row.stats_json)
				: row.statsJson !== undefined && row.statsJson !== null
					? String(row.statsJson)
					: null,
		snapshotRef:
			row.snapshot_ref !== undefined && row.snapshot_ref !== null
				? String(row.snapshot_ref)
				: row.snapshotRef !== undefined && row.snapshotRef !== null
					? String(row.snapshotRef)
					: null,
		createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
	};
}

function reportFromRow(row: DatabaseRow): SdkReportEntity {
	return {
		id: String(row.id ?? ''),
		workDayId: String(row.work_day_id ?? row.workDayId ?? ''),
		kind: String(row.kind ?? ''),
		bodyJson: String(row.body_json ?? row.bodyJson ?? '{}'),
		renderedRef:
			row.rendered_ref !== undefined && row.rendered_ref !== null
				? String(row.rendered_ref)
				: row.renderedRef !== undefined && row.renderedRef !== null
					? String(row.renderedRef)
					: null,
		sentAt:
			row.sent_at !== undefined && row.sent_at !== null
				? String(row.sent_at)
				: row.sentAt !== undefined && row.sentAt !== null
					? String(row.sentAt)
					: null,
		createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
	};
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
	if (typeof value !== 'string' || !value.trim()) {
		return fallback;
	}
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function normalizeAutoscale(value: Record<string, unknown> | undefined, fallback?: AgentPoolAutoscalePolicy): AgentPoolAutoscalePolicy {
	return {
		minWorkers: Number(value?.minWorkers ?? fallback?.minWorkers ?? 0),
		maxWorkers: Number(value?.maxWorkers ?? fallback?.maxWorkers ?? 1),
		targetQueueDepth: Number(value?.targetQueueDepth ?? fallback?.targetQueueDepth ?? 1),
		cooldownSeconds: Number(value?.cooldownSeconds ?? fallback?.cooldownSeconds ?? 60),
	};
}

function workPolicyFromRow(row: DatabaseRow): WorkdayPolicy {
	const metadata = parseJsonValue<Record<string, unknown>>(row.metadata_json, {});
	const autoscale = normalizeAutoscale(parseJsonValue(row.autoscale_json, {}));
	const dailyCreditBudget = Number(row.daily_credit_budget ?? row.daily_task_credit_budget ?? 0);
	return {
		projectId: String(row.project_id ?? ''),
		environment: String(row.environment ?? 'local') as WorkdayPolicy['environment'],
		schedule: parseJsonValue<WorkdaySchedule>(row.schedule_json, {
			timezone: 'UTC',
			windows: [],
		}),
		enabled: row.enabled === undefined || row.enabled === null ? metadata.enabled !== false : Number(row.enabled) !== 0,
		startCron: String(row.start_cron ?? metadata.startCron ?? '0 9 * * 1-5'),
		durationMinutes: Number(row.duration_minutes ?? metadata.durationMinutes ?? 480),
		maxRunners: Number(row.max_runners ?? metadata.maxRunners ?? autoscale.maxWorkers ?? 1),
		maxWorkersPerRunner: Number(row.max_workers_per_runner ?? metadata.maxWorkersPerRunner ?? 4),
		dailyCreditBudget,
		closeoutGraceMinutes: Number(row.closeout_grace_minutes ?? metadata.closeoutGraceMinutes ?? 15),
		dailyTaskCreditBudget: dailyCreditBudget,
		maxQueuedTasks: Number(row.max_queued_tasks ?? 0),
		maxQueuedCredits: Number(row.max_queued_credits ?? 0),
		autoscale,
		creditWeights: parseJsonValue<TaskCreditWeight[]>(row.credit_weights_json, []),
		metadata,
	};
}

function workdayRequestFromRow(row: DatabaseRow): WorkdayRequest {
	return {
		id: String(row.id ?? ''),
		projectId: String(row.project_id ?? ''),
		environment: String(row.environment ?? 'local') as WorkdayRequest['environment'],
		type: String(row.type ?? 'one_off_run') as WorkdayRequest['type'],
		state: String(row.state ?? 'pending') as WorkdayRequest['state'],
		workDayId: row.work_day_id === undefined || row.work_day_id === null ? null : String(row.work_day_id),
		requestedBy: row.requested_by === undefined || row.requested_by === null ? null : String(row.requested_by),
		reason: row.reason === undefined || row.reason === null ? null : String(row.reason),
		payload: parseJsonValue<Record<string, unknown>>(row.payload_json, {}),
		metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
		createdAt: String(row.created_at ?? nowIso()),
		updatedAt: String(row.updated_at ?? nowIso()),
	};
}

function workdayManagerLeaseFromRow(row: DatabaseRow): WorkdayManagerLease {
	return {
		id: String(row.id ?? ''),
		projectId: String(row.project_id ?? ''),
		environment: String(row.environment ?? 'local') as WorkdayManagerLease['environment'],
		workDayId: row.work_day_id === undefined || row.work_day_id === null ? null : String(row.work_day_id),
		managerId: String(row.manager_id ?? ''),
		state: String(row.state ?? 'active') as WorkdayManagerLease['state'],
		heartbeatAt: String(row.heartbeat_at ?? nowIso()),
		expiresAt: String(row.expires_at ?? nowIso()),
		metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
		createdAt: String(row.created_at ?? nowIso()),
		updatedAt: String(row.updated_at ?? nowIso()),
	};
}

function workerRunnerFromRow(row: DatabaseRow): WorkerRunner {
	return {
		id: String(row.id ?? ''),
		projectId: String(row.project_id ?? ''),
		environment: String(row.environment ?? 'local') as WorkerRunner['environment'],
		runnerId: String(row.runner_id ?? ''),
		runnerServiceName: String(row.runner_service_name ?? ''),
		volumeIdentity: String(row.volume_identity ?? ''),
		state: String(row.state ?? 'active') as WorkerRunner['state'],
		maxLocalWorkers: Number(row.max_local_workers ?? 4),
		activeLocalWorkers: Number(row.active_local_workers ?? 0),
		availableCapacity: Number(row.available_capacity ?? 0),
		lastHeartbeatAt: row.last_heartbeat_at === undefined || row.last_heartbeat_at === null ? null : String(row.last_heartbeat_at),
		claimedRepositoryIds: parseJsonValue<string[]>(row.claimed_repository_ids_json, []),
		metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
		createdAt: String(row.created_at ?? nowIso()),
		updatedAt: String(row.updated_at ?? nowIso()),
	};
}

function repositoryClaimFromRow(row: DatabaseRow): RepositoryClaim {
	return {
		id: String(row.id ?? ''),
		projectId: String(row.project_id ?? ''),
		repositoryId: String(row.repository_id ?? ''),
		runnerId: String(row.runner_id ?? ''),
		runnerServiceName: String(row.runner_service_name ?? ''),
		volumeIdentity: String(row.volume_identity ?? ''),
		lastSeenCommit: row.last_seen_commit === undefined || row.last_seen_commit === null ? null : String(row.last_seen_commit),
		lastTaskAt: row.last_task_at === undefined || row.last_task_at === null ? null : String(row.last_task_at),
		claimState: String(row.claim_state ?? 'active') as RepositoryClaim['claimState'],
		metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
		createdAt: String(row.created_at ?? nowIso()),
		updatedAt: String(row.updated_at ?? nowIso()),
	};
}

function runnerScaleDecisionFromRow(row: DatabaseRow): RunnerScaleDecision {
	return {
		id: String(row.id ?? ''),
		projectId: String(row.project_id ?? ''),
		environment: String(row.environment ?? 'local') as RunnerScaleDecision['environment'],
		workDayId: row.work_day_id === undefined || row.work_day_id === null ? null : String(row.work_day_id),
		runnerId: row.runner_id === undefined || row.runner_id === null ? null : String(row.runner_id),
		runnerServiceName: row.runner_service_name === undefined || row.runner_service_name === null ? null : String(row.runner_service_name),
		action: String(row.action ?? 'noop') as RunnerScaleDecision['action'],
		reason: String(row.reason ?? 'reconcile'),
		metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
		createdAt: String(row.created_at ?? nowIso()),
	};
}

function prioritySnapshotFromRow(row: DatabaseRow): PrioritySnapshot {
	const payload = parseJsonValue<Record<string, unknown>>(row.snapshot_json, {});
	return {
		id: String(row.id ?? ''),
		projectId: String(row.project_id ?? ''),
		workDayId:
			row.work_day_id !== undefined && row.work_day_id !== null
				? String(row.work_day_id)
				: null,
		generatedAt: String(row.generated_at ?? row.created_at ?? nowIso()),
		items: Array.isArray(payload.items) ? payload.items as PrioritySnapshot['items'] : [],
		metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
	};
}

function taskCreditLedgerEntryFromRow(row: DatabaseRow): TaskCreditLedgerEntry {
	return {
		id: String(row.id ?? ''),
		projectId: String(row.project_id ?? ''),
		workDayId: String(row.work_day_id ?? ''),
		taskId:
			row.task_id !== undefined && row.task_id !== null
				? String(row.task_id)
				: null,
		phase: String(row.phase ?? 'seed') as TaskCreditLedgerEntry['phase'],
		credits: Number(row.credits ?? 0),
		metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
		createdAt: String(row.created_at ?? nowIso()),
	};
}

function scaleDecisionFromRow(row: DatabaseRow): ScaleDecision {
	return {
		id: String(row.id ?? ''),
		projectId: String(row.project_id ?? ''),
		environment: String(row.environment ?? 'local') as ScaleDecision['environment'],
		poolName: String(row.pool_name ?? ''),
		workDayId:
			row.work_day_id !== undefined && row.work_day_id !== null
				? String(row.work_day_id)
				: null,
		desiredWorkers: Number(row.desired_workers ?? 0),
		observedQueueDepth: Number(row.observed_queue_depth ?? 0),
		observedActiveLeases: Number(row.observed_active_leases ?? 0),
		reason: String(row.reason ?? 'reconcile'),
		metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
		createdAt: String(row.created_at ?? nowIso()),
	};
}

function approvalRequestFromRow(row: DatabaseRow): ApprovalRequest {
	return {
		id: String(row.id ?? ''),
		teamId: String(row.team_id ?? ''),
		projectId: String(row.project_id ?? ''),
		workDayId: row.work_day_id === undefined || row.work_day_id === null ? null : String(row.work_day_id),
		taskId: row.task_id === undefined || row.task_id === null ? null : String(row.task_id),
		kind: String(row.kind ?? ''),
		state: String(row.state ?? 'pending') as ApprovalRequest['state'],
		severity: String(row.severity ?? 'medium') as ApprovalRequest['severity'],
		requestedByType: String(row.requested_by_type ?? 'worker') as ApprovalRequest['requestedByType'],
		requestedById: row.requested_by_id === undefined || row.requested_by_id === null ? null : String(row.requested_by_id),
		title: String(row.title ?? ''),
		summary: String(row.summary ?? ''),
		options: parseJsonValue<Record<string, unknown>[]>(row.options_json, []),
		recommendation: parseJsonValue<Record<string, unknown>>(row.recommendation_json, {}),
		policySnapshot: parseJsonValue<Record<string, unknown>>(row.policy_snapshot_json, {}),
		expiresAt: row.expires_at === undefined || row.expires_at === null ? null : String(row.expires_at),
		decidedByType: row.decided_by_type === undefined || row.decided_by_type === null ? null : String(row.decided_by_type),
		decidedById: row.decided_by_id === undefined || row.decided_by_id === null ? null : String(row.decided_by_id),
		decidedAt: row.decided_at === undefined || row.decided_at === null ? null : String(row.decided_at),
		decision: row.decision_json === undefined || row.decision_json === null ? null : parseJsonValue<Record<string, unknown> | null>(row.decision_json, null),
		metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
		createdAt: String(row.created_at ?? nowIso()),
		updatedAt: String(row.updated_at ?? nowIso()),
	};
}

function teamInboxItemFromRow(row: DatabaseRow): InboxItem {
	return {
		id: String(row.id ?? ''),
		teamId: String(row.team_id ?? ''),
		projectId: row.project_id === undefined || row.project_id === null ? null : String(row.project_id),
		kind: String(row.kind ?? ''),
		state: String(row.state ?? 'informational'),
		title: String(row.title ?? ''),
		summary: row.summary === undefined || row.summary === null ? null : String(row.summary),
		href: row.href === undefined || row.href === null ? null : String(row.href),
		itemKey: row.item_key === undefined || row.item_key === null ? null : String(row.item_key),
		metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
		createdAt: String(row.created_at ?? nowIso()),
		updatedAt: String(row.updated_at ?? nowIso()),
	};
}

export class OperationalStore extends SqliteStoreBase {
	private governanceInitialized = false;
	private runnerInitialized = false;

	private async ensureGovernanceSchema() {
		if (this.governanceInitialized) return;
		await this.execute(`CREATE TABLE IF NOT EXISTS approval_requests (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			work_day_id TEXT,
			task_id TEXT,
			kind TEXT NOT NULL,
			state TEXT NOT NULL DEFAULT 'pending',
			severity TEXT NOT NULL DEFAULT 'medium',
			requested_by_type TEXT NOT NULL DEFAULT 'worker',
			requested_by_id TEXT,
			title TEXT NOT NULL,
			summary TEXT NOT NULL,
			options_json TEXT NOT NULL DEFAULT '[]',
			recommendation_json TEXT NOT NULL DEFAULT '{}',
			policy_snapshot_json TEXT NOT NULL DEFAULT '{}',
			expires_at TEXT,
			decided_by_type TEXT,
			decided_by_id TEXT,
			decided_at TEXT,
			decision_json TEXT,
			metadata_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`);
		await this.execute('CREATE INDEX IF NOT EXISTS idx_approval_requests_team_state ON approval_requests(team_id, state, created_at DESC)');
		await this.execute('CREATE INDEX IF NOT EXISTS idx_approval_requests_project_workday ON approval_requests(project_id, work_day_id, state, created_at DESC)');
		await this.execute(`CREATE TABLE IF NOT EXISTS team_inbox_items (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			project_id TEXT,
			kind TEXT NOT NULL,
			state TEXT NOT NULL,
			title TEXT NOT NULL,
			summary TEXT,
			href TEXT,
			item_key TEXT,
			metadata_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`);
		await this.execute('CREATE INDEX IF NOT EXISTS idx_team_inbox_items_team_created ON team_inbox_items(team_id, created_at DESC)');
		this.governanceInitialized = true;
	}

	private async ensureRunnerSchema() {
		if (this.runnerInitialized) return;
		await this.execute(`CREATE TABLE IF NOT EXISTS workday_manager_leases (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			environment TEXT NOT NULL,
			work_day_id TEXT,
			manager_id TEXT NOT NULL,
			state TEXT NOT NULL DEFAULT 'active',
			heartbeat_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			metadata_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`);
		await this.execute('CREATE INDEX IF NOT EXISTS idx_workday_manager_leases_active ON workday_manager_leases(project_id, environment, state, heartbeat_at DESC)');
		await this.execute(`CREATE TABLE IF NOT EXISTS worker_runners (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			environment TEXT NOT NULL,
			runner_id TEXT NOT NULL,
			runner_service_name TEXT NOT NULL,
			volume_identity TEXT NOT NULL,
			state TEXT NOT NULL,
			max_local_workers INTEGER NOT NULL DEFAULT 4,
			active_local_workers INTEGER NOT NULL DEFAULT 0,
			available_capacity INTEGER NOT NULL DEFAULT 0,
			last_heartbeat_at TEXT NOT NULL,
			claimed_repository_ids_json TEXT NOT NULL DEFAULT '[]',
			metadata_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`);
		await this.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_runners_identity ON worker_runners(project_id, environment, runner_id)');
		await this.execute('CREATE INDEX IF NOT EXISTS idx_worker_runners_state_capacity ON worker_runners(project_id, environment, state, available_capacity DESC)');
		this.runnerInitialized = true;
	}

	async getWorkDay(id: string) {
		const row = await this.selectFirst(`SELECT * FROM work_days WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? workDayFromRow(row) : null;
	}

	async searchWorkDays(limit = 20) {
		const rows = await this.selectAll(`SELECT * FROM work_days ORDER BY updated_at DESC LIMIT ${limit}`);
		return rows.map(workDayFromRow);
	}

	async startWorkDay(request: SdkStartWorkDayRequest) {
		const id = request.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT OR REPLACE INTO work_days (id, project_id, state, capacity_budget, capacity_used, graph_version, summary_json, started_at, ended_at, created_at, updated_at) VALUES (${toSqlValue(id)}, ${toSqlValue(request.projectId)}, 'active', ${Number(request.capacityBudget ?? 0)}, 0, ${toSqlValue(request.graphVersion ?? null)}, ${toSqlValue(json(request.summary ?? null))}, ${toSqlValue(timestamp)}, NULL, COALESCE((SELECT created_at FROM work_days WHERE id = ${toSqlValue(id)}), ${toSqlValue(timestamp)}), ${toSqlValue(timestamp)})`,
		);
		return this.getWorkDay(id);
	}

	async closeWorkDay(request: SdkCloseWorkDayRequest) {
		const existing = await this.getWorkDay(request.id);
		if (!existing) {
			return null;
		}
		const timestamp = nowIso();
		await this.execute(
			`UPDATE work_days SET state = ${toSqlValue(request.state ?? 'completed')}, summary_json = ${toSqlValue(json(request.summary ?? null))}, ended_at = ${toSqlValue(timestamp)}, updated_at = ${toSqlValue(timestamp)} WHERE id = ${toSqlValue(request.id)}`,
		);
		return this.getWorkDay(request.id);
	}

	async getTask(id: string) {
		const row = await this.selectFirst(`SELECT * FROM tasks WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? taskFromRow(row) : null;
	}

	async searchTasks(request: SdkTaskSearchRequest = {}) {
		const clauses = [];
		if (request.workDayId) clauses.push(`work_day_id = ${toSqlValue(request.workDayId)}`);
		if (request.agentId) clauses.push(`agent_id = ${toSqlValue(request.agentId)}`);
		if (request.state) {
			const states = Array.isArray(request.state) ? request.state : [request.state];
			clauses.push(`state IN (${states.map((entry) => toSqlValue(entry)).join(', ')})`);
		}
		const sql = [
			'SELECT * FROM tasks',
			clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
			'ORDER BY priority DESC, available_at ASC, created_at ASC',
			`LIMIT ${request.limit ?? 50}`,
		].filter(Boolean).join(' ');
		const rows = await this.selectAll(sql);
		return rows.map(taskFromRow);
	}

	async createTask(request: SdkCreateTaskRequest) {
		const id = request.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT OR REPLACE INTO tasks (id, work_day_id, agent_id, type, state, priority, idempotency_key, payload_json, payload_hash, attempt_count, max_attempts, claimed_by, lease_expires_at, available_at, last_error_code, last_error_message, graph_version, parent_task_id, created_at, started_at, completed_at, updated_at) VALUES (${toSqlValue(id)}, ${toSqlValue(request.workDayId)}, ${toSqlValue(request.agentId)}, ${toSqlValue(request.type)}, ${toSqlValue(request.state ?? 'pending')}, ${Number(request.priority ?? 0)}, ${toSqlValue(request.idempotencyKey)}, ${toSqlValue(json(request.payload))}, ${toSqlValue(request.payloadHash ?? null)}, 0, ${Number(request.maxAttempts ?? 3)}, NULL, NULL, ${toSqlValue(request.availableAt ?? timestamp)}, NULL, NULL, ${toSqlValue(request.graphVersion ?? null)}, ${toSqlValue(request.parentTaskId ?? null)}, COALESCE((SELECT created_at FROM tasks WHERE id = ${toSqlValue(id)}), ${toSqlValue(timestamp)}), NULL, NULL, ${toSqlValue(timestamp)})`,
		);
		return this.getTask(id);
	}

	async claimTask(request: SdkClaimTaskRequest) {
		const existing = await this.getTask(request.id);
		if (!existing) {
			return null;
		}
		const timestamp = nowIso();
		const leaseExpiresAt = new Date(Date.now() + request.leaseSeconds * 1000).toISOString();
		await this.execute(
			`UPDATE tasks SET state = 'claimed', claimed_by = ${toSqlValue(request.workerId)}, lease_expires_at = ${toSqlValue(leaseExpiresAt)}, attempt_count = attempt_count + 1, started_at = COALESCE(started_at, ${toSqlValue(timestamp)}), updated_at = ${toSqlValue(timestamp)} WHERE id = ${toSqlValue(request.id)}`,
		);
		return this.getTask(request.id);
	}

	async recordTaskProgress(request: SdkTaskProgressRequest) {
		const existing = await this.getTask(request.id);
		if (!existing) {
			return null;
		}
		const patch = request.patch ?? {};
		const currentPayload = JSON.parse(existing.payloadJson) as Record<string, unknown>;
		const nextPayload = { ...currentPayload, ...patch };
		const timestamp = nowIso();
		await this.execute(
			`UPDATE tasks SET state = ${toSqlValue(request.state ?? existing.state)}, payload_json = ${toSqlValue(json(nextPayload))}, claimed_by = ${toSqlValue(request.workerId ?? existing.claimedBy)}, updated_at = ${toSqlValue(timestamp)} WHERE id = ${toSqlValue(request.id)}`,
		);
		if (request.appendEvent?.kind) {
			await this.appendTaskEvent({
				taskId: request.id,
				kind: request.appendEvent.kind,
				data: request.appendEvent.data,
				actor: request.actor,
			});
		}
		return this.getTask(request.id);
	}

	async completeTask(request: SdkCompleteTaskRequest) {
		const existing = await this.getTask(request.id);
		if (!existing) {
			return null;
		}
		const timestamp = nowIso();
		await this.execute(
			`UPDATE tasks SET state = 'completed', completed_at = ${toSqlValue(timestamp)}, lease_expires_at = NULL, updated_at = ${toSqlValue(timestamp)} WHERE id = ${toSqlValue(request.id)}`,
		);
		if (request.output) {
			await this.execute(
				`INSERT INTO task_outputs (id, task_id, output_json, output_ref, created_at) VALUES (${toSqlValue(crypto.randomUUID())}, ${toSqlValue(request.id)}, ${toSqlValue(json(request.output))}, ${toSqlValue(request.outputRef ?? null)}, ${toSqlValue(timestamp)})`,
			);
		}
		if (request.summary) {
			await this.appendTaskEvent({
				taskId: request.id,
				kind: 'completed',
				data: request.summary,
				actor: request.actor,
			});
		}
		return this.getTask(request.id);
	}

	async failTask(request: SdkFailTaskRequest) {
		const existing = await this.getTask(request.id);
		if (!existing) {
			return null;
		}
		const timestamp = nowIso();
		const nextState = request.retryable ? 'pending' : 'failed';
		await this.execute(
			`UPDATE tasks SET state = ${toSqlValue(nextState)}, available_at = ${toSqlValue(request.nextVisibleAt ?? existing.availableAt)}, last_error_code = ${toSqlValue(request.errorCode ?? null)}, last_error_message = ${toSqlValue(request.errorMessage)}, lease_expires_at = NULL, updated_at = ${toSqlValue(timestamp)} WHERE id = ${toSqlValue(request.id)}`,
		);
		await this.appendTaskEvent({
			taskId: request.id,
			kind: nextState === 'pending' ? 'retry_scheduled' : 'failed',
			data: { errorCode: request.errorCode ?? null, errorMessage: request.errorMessage },
			actor: request.actor,
		});
		return this.getTask(request.id);
	}

	async appendTaskEvent(request: SdkAppendTaskEventRequest) {
		const seqRow = await this.selectFirst(
			`SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM task_events WHERE task_id = ${toSqlValue(request.taskId)}`,
		);
		const seq = Number(seqRow?.next_seq ?? 1);
		const id = crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT INTO task_events (id, task_id, seq, kind, data_json, created_at) VALUES (${toSqlValue(id)}, ${toSqlValue(request.taskId)}, ${seq}, ${toSqlValue(request.kind)}, ${toSqlValue(json({ ...(request.data ?? {}), actor: request.actor }))}, ${toSqlValue(timestamp)})`,
		);
		const row = await this.selectFirst(`SELECT * FROM task_events WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? taskEventFromRow(row) : null;
	}

	async listTaskEvents(taskId: string) {
		const rows = await this.selectAll(
			`SELECT * FROM task_events WHERE task_id = ${toSqlValue(taskId)} ORDER BY seq ASC`,
		);
		return rows.map(taskEventFromRow);
	}

	async getTaskEvent(id: string) {
		const row = await this.selectFirst(`SELECT * FROM task_events WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? taskEventFromRow(row) : null;
	}

	async searchTaskEvents(request: { id?: string | string[]; taskId?: string | string[]; kind?: string | string[]; limit?: number } = {}) {
		const clauses = [];
		if (request.id) {
			const ids = Array.isArray(request.id) ? request.id : [request.id];
			clauses.push(`id IN (${ids.map((entry) => toSqlValue(entry)).join(', ')})`);
		}
		if (request.taskId) {
			const taskIds = Array.isArray(request.taskId) ? request.taskId : [request.taskId];
			clauses.push(`task_id IN (${taskIds.map((entry) => toSqlValue(entry)).join(', ')})`);
		}
		if (request.kind) {
			const kinds = Array.isArray(request.kind) ? request.kind : [request.kind];
			clauses.push(`kind IN (${kinds.map((entry) => toSqlValue(entry)).join(', ')})`);
		}
		const sql = [
			'SELECT * FROM task_events',
			clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
			'ORDER BY created_at DESC, seq DESC',
			`LIMIT ${request.limit ?? 50}`,
		].filter(Boolean).join(' ');
		const rows = await this.selectAll(sql);
		return rows.map(taskEventFromRow);
	}

	async listTaskOutputs(taskId: string) {
		const rows = await this.selectAll(
			`SELECT * FROM task_outputs WHERE task_id = ${toSqlValue(taskId)} ORDER BY created_at ASC`,
		);
		return rows.map(taskOutputFromRow);
	}

	async getTaskOutput(id: string) {
		const row = await this.selectFirst(`SELECT * FROM task_outputs WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? taskOutputFromRow(row) : null;
	}

	async searchTaskOutputs(request: { id?: string | string[]; taskId?: string | string[]; limit?: number } = {}) {
		const clauses = [];
		if (request.id) {
			const ids = Array.isArray(request.id) ? request.id : [request.id];
			clauses.push(`id IN (${ids.map((entry) => toSqlValue(entry)).join(', ')})`);
		}
		if (request.taskId) {
			const taskIds = Array.isArray(request.taskId) ? request.taskId : [request.taskId];
			clauses.push(`task_id IN (${taskIds.map((entry) => toSqlValue(entry)).join(', ')})`);
		}
		const sql = [
			'SELECT * FROM task_outputs',
			clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
			'ORDER BY created_at DESC',
			`LIMIT ${request.limit ?? 50}`,
		].filter(Boolean).join(' ');
		const rows = await this.selectAll(sql);
		return rows.map(taskOutputFromRow);
	}

	async createGraphRun(input: Omit<SdkGraphRunEntity, 'createdAt'> & { createdAt?: string }) {
		const timestamp = input.createdAt ?? nowIso();
		await this.execute(
			`INSERT OR REPLACE INTO graph_runs (id, work_day_id, corpus_hash, graph_version, query_json, seed_ids_json, selected_node_ids_json, stats_json, snapshot_ref, created_at) VALUES (${toSqlValue(input.id)}, ${toSqlValue(input.workDayId)}, ${toSqlValue(input.corpusHash)}, ${toSqlValue(input.graphVersion)}, ${toSqlValue(input.queryJson ?? null)}, ${toSqlValue(input.seedIdsJson ?? null)}, ${toSqlValue(input.selectedNodeIdsJson ?? null)}, ${toSqlValue(input.statsJson ?? null)}, ${toSqlValue(input.snapshotRef ?? null)}, ${toSqlValue(timestamp)})`,
		);
		const row = await this.selectFirst(`SELECT * FROM graph_runs WHERE id = ${toSqlValue(input.id)} LIMIT 1`);
		return row ? graphRunFromRow(row) : null;
	}

	async getLatestGraphRun(workDayId: string) {
		const row = await this.selectFirst(
			`SELECT * FROM graph_runs WHERE work_day_id = ${toSqlValue(workDayId)} ORDER BY created_at DESC LIMIT 1`,
		);
		return row ? graphRunFromRow(row) : null;
	}

	async createReport(request: SdkCreateReportRequest) {
		const id = request.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT OR REPLACE INTO reports (id, work_day_id, kind, body_json, rendered_ref, sent_at, created_at) VALUES (${toSqlValue(id)}, ${toSqlValue(request.workDayId)}, ${toSqlValue(request.kind)}, ${toSqlValue(json(request.body))}, ${toSqlValue(request.renderedRef ?? null)}, ${toSqlValue(request.sentAt ?? null)}, ${toSqlValue(timestamp)})`,
		);
		const row = await this.selectFirst(`SELECT * FROM reports WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? reportFromRow(row) : null;
	}

	async getReport(id: string) {
		const row = await this.selectFirst(`SELECT * FROM reports WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? reportFromRow(row) : null;
	}

	async getWorkPolicy(projectId: string, environment: string = 'local') {
		if (!(await this.tableExists('work_policies'))) {
			return null;
		}
		const row = await this.selectFirst(
			`SELECT * FROM work_policies WHERE project_id = ${toSqlValue(projectId)} AND environment = ${toSqlValue(environment)} LIMIT 1`,
		);
		return row ? workPolicyFromRow(row) : null;
	}

	async upsertWorkPolicy(request: SdkUpsertWorkPolicyRequest) {
		const timestamp = nowIso();
		const dailyCreditBudget = Number(request.dailyCreditBudget ?? request.dailyTaskCreditBudget ?? 0);
		await this.execute(
			`INSERT OR REPLACE INTO work_policies (
				project_id, environment, schedule_json, enabled, start_cron, duration_minutes, max_runners, max_workers_per_runner, daily_credit_budget, closeout_grace_minutes, daily_task_credit_budget, max_queued_tasks, max_queued_credits, autoscale_json, credit_weights_json, metadata_json, created_at, updated_at
			) VALUES (
				${toSqlValue(request.projectId)},
				${toSqlValue(request.environment)},
				${toSqlValue(json(request.schedule))},
				${request.enabled === false ? 0 : 1},
				${toSqlValue(request.startCron ?? '0 9 * * 1-5')},
				${Number(request.durationMinutes ?? 480)},
				${Number(request.maxRunners ?? request.autoscale.maxWorkers ?? 1)},
				${Number(request.maxWorkersPerRunner ?? 4)},
				${dailyCreditBudget},
				${Number(request.closeoutGraceMinutes ?? 15)},
				${dailyCreditBudget},
				${Number(request.maxQueuedTasks ?? 0)},
				${Number(request.maxQueuedCredits ?? 0)},
				${toSqlValue(json(request.autoscale))},
				${toSqlValue(json(request.creditWeights ?? []))},
				${toSqlValue(json(request.metadata ?? {}))},
				COALESCE((SELECT created_at FROM work_policies WHERE project_id = ${toSqlValue(request.projectId)} AND environment = ${toSqlValue(request.environment)}), ${toSqlValue(timestamp)}),
				${toSqlValue(timestamp)}
			)`,
		);
		return this.getWorkPolicy(request.projectId, request.environment);
	}

	async createWorkdayRequest(request: SdkCreateWorkdayRequest) {
		const id = request.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT INTO workday_requests (
				id, project_id, environment, type, state, work_day_id, requested_by, reason, payload_json, metadata_json, created_at, updated_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(request.projectId)},
				${toSqlValue(request.environment)},
				${toSqlValue(request.type)},
				${toSqlValue(request.state ?? 'pending')},
				${toSqlValue(request.workDayId ?? null)},
				${toSqlValue(request.requestedBy ?? null)},
				${toSqlValue(request.reason ?? null)},
				${toSqlValue(json(request.payload ?? {}))},
				${toSqlValue(json(request.metadata ?? {}))},
				${toSqlValue(timestamp)},
				${toSqlValue(timestamp)}
			)`,
		);
		const row = await this.selectFirst(`SELECT * FROM workday_requests WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? workdayRequestFromRow(row) : null;
	}

	async listWorkdayRequests(projectId: string, environment: string, state?: string | null) {
		if (!(await this.tableExists('workday_requests'))) return [];
		const rows = await this.selectAll(
			`SELECT * FROM workday_requests WHERE project_id = ${toSqlValue(projectId)} AND environment = ${toSqlValue(environment)}${state ? ` AND state = ${toSqlValue(state)}` : ''} ORDER BY created_at ASC`,
		);
		return rows.map(workdayRequestFromRow);
	}

	async claimWorkdayManagerLease(request: SdkClaimWorkdayManagerLeaseRequest) {
		await this.ensureRunnerSchema();
		const timestamp = request.now ?? nowIso();
		const active = await this.selectFirst(
			`SELECT * FROM workday_manager_leases WHERE project_id = ${toSqlValue(request.projectId)} AND environment = ${toSqlValue(request.environment)} AND state = 'active' ORDER BY updated_at DESC LIMIT 1`,
		);
		if (active && String(active.manager_id ?? '') !== request.managerId) {
			const heartbeatMs = Date.parse(String(active.heartbeat_at ?? ''));
			const nowMs = Date.parse(timestamp);
			const staleAfterMs = (request.staleAfterSeconds ?? request.ttlSeconds) * 1000;
			if (Number.isFinite(heartbeatMs) && Number.isFinite(nowMs) && nowMs - heartbeatMs <= staleAfterMs) {
				return null;
			}
		}
		const id = active ? String(active.id) : request.id ?? crypto.randomUUID();
		const expiresAt = new Date(Date.parse(timestamp) + (request.ttlSeconds * 1000)).toISOString();
		await this.execute(
			`INSERT OR REPLACE INTO workday_manager_leases (
				id, project_id, environment, work_day_id, manager_id, state, heartbeat_at, expires_at, metadata_json, created_at, updated_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(request.projectId)},
				${toSqlValue(request.environment)},
				${toSqlValue(request.workDayId ?? active?.work_day_id ?? null)},
				${toSqlValue(request.managerId)},
				'active',
				${toSqlValue(timestamp)},
				${toSqlValue(expiresAt)},
				${toSqlValue(json(request.metadata ?? parseJsonValue(active?.metadata_json, {})))},
				COALESCE((SELECT created_at FROM workday_manager_leases WHERE id = ${toSqlValue(id)}), ${toSqlValue(timestamp)}),
				${toSqlValue(timestamp)}
			)`,
		);
		const row = await this.selectFirst(`SELECT * FROM workday_manager_leases WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? workdayManagerLeaseFromRow(row) : null;
	}

	async releaseWorkdayManagerLease(request: SdkReleaseWorkdayManagerLeaseRequest) {
		await this.ensureRunnerSchema();
		const timestamp = nowIso();
		await this.execute(
			`UPDATE workday_manager_leases SET state = 'released', updated_at = ${toSqlValue(timestamp)} WHERE id = ${toSqlValue(request.id)} AND manager_id = ${toSqlValue(request.managerId)}`,
		);
		const row = await this.selectFirst(`SELECT * FROM workday_manager_leases WHERE id = ${toSqlValue(request.id)} LIMIT 1`);
		return row ? workdayManagerLeaseFromRow(row) : null;
	}

	async listWorkdayManagerLeases(projectId: string, environment: string) {
		await this.ensureRunnerSchema();
		if (!(await this.tableExists('workday_manager_leases'))) return [];
		const rows = await this.selectAll(
			`SELECT * FROM workday_manager_leases WHERE project_id = ${toSqlValue(projectId)} AND environment = ${toSqlValue(environment)} ORDER BY heartbeat_at DESC, updated_at DESC LIMIT 10`,
		);
		return rows.map(workdayManagerLeaseFromRow);
	}

	async recordWorkerRunner(request: SdkRecordWorkerRunnerRequest) {
		await this.ensureRunnerSchema();
		const timestamp = nowIso();
		const id = request.id ?? `${request.projectId}:${request.environment}:${request.runnerId}`;
		const maxLocalWorkers = Number(request.maxLocalWorkers ?? 4);
		const activeLocalWorkers = Number(request.activeLocalWorkers ?? 0);
		await this.execute(
			`INSERT OR REPLACE INTO worker_runners (
				id, project_id, environment, runner_id, runner_service_name, volume_identity, state, max_local_workers, active_local_workers, available_capacity, last_heartbeat_at, claimed_repository_ids_json, metadata_json, created_at, updated_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(request.projectId)},
				${toSqlValue(request.environment)},
				${toSqlValue(request.runnerId)},
				${toSqlValue(request.runnerServiceName)},
				${toSqlValue(request.volumeIdentity)},
				${toSqlValue(request.state ?? 'active')},
				${maxLocalWorkers},
				${activeLocalWorkers},
				${Math.max(0, maxLocalWorkers - activeLocalWorkers)},
				${toSqlValue(timestamp)},
				${toSqlValue(json(request.claimedRepositoryIds ?? []))},
				${toSqlValue(json(request.metadata ?? {}))},
				COALESCE((SELECT created_at FROM worker_runners WHERE id = ${toSqlValue(id)}), ${toSqlValue(timestamp)}),
				${toSqlValue(timestamp)}
			)`,
		);
		const row = await this.selectFirst(`SELECT * FROM worker_runners WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? workerRunnerFromRow(row) : null;
	}

	async listWorkerRunners(projectId: string, environment: string) {
		await this.ensureRunnerSchema();
		if (!(await this.tableExists('worker_runners'))) return [];
		const rows = await this.selectAll(
			`SELECT * FROM worker_runners WHERE project_id = ${toSqlValue(projectId)} AND environment = ${toSqlValue(environment)} ORDER BY runner_id ASC`,
		);
		return rows.map(workerRunnerFromRow);
	}

	async recordRepositoryClaim(request: SdkRecordRepositoryClaimRequest) {
		const timestamp = nowIso();
		const id = request.id ?? `${request.projectId}:${request.repositoryId}:${request.runnerId}`;
		await this.execute(
			`INSERT OR REPLACE INTO repository_claims (
				id, project_id, repository_id, runner_id, runner_service_name, volume_identity, last_seen_commit, last_task_at, claim_state, metadata_json, created_at, updated_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(request.projectId)},
				${toSqlValue(request.repositoryId)},
				${toSqlValue(request.runnerId)},
				${toSqlValue(request.runnerServiceName)},
				${toSqlValue(request.volumeIdentity)},
				${toSqlValue(request.lastSeenCommit ?? null)},
				${toSqlValue(request.lastTaskAt ?? timestamp)},
				${toSqlValue(request.claimState ?? 'active')},
				${toSqlValue(json(request.metadata ?? {}))},
				COALESCE((SELECT created_at FROM repository_claims WHERE id = ${toSqlValue(id)}), ${toSqlValue(timestamp)}),
				${toSqlValue(timestamp)}
			)`,
		);
		const row = await this.selectFirst(`SELECT * FROM repository_claims WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? repositoryClaimFromRow(row) : null;
	}

	async listRepositoryClaims(projectId: string, repositoryId?: string | null) {
		if (!(await this.tableExists('repository_claims'))) return [];
		const rows = await this.selectAll(
			`SELECT * FROM repository_claims WHERE project_id = ${toSqlValue(projectId)}${repositoryId ? ` AND repository_id = ${toSqlValue(repositoryId)}` : ''} ORDER BY updated_at DESC`,
		);
		return rows.map(repositoryClaimFromRow);
	}

	async recordRunnerScaleDecision(request: SdkRecordRunnerScaleDecisionRequest) {
		const id = request.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT INTO runner_scale_decisions (
				id, project_id, environment, work_day_id, runner_id, runner_service_name, action, reason, metadata_json, created_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(request.projectId)},
				${toSqlValue(request.environment)},
				${toSqlValue(request.workDayId ?? null)},
				${toSqlValue(request.runnerId ?? null)},
				${toSqlValue(request.runnerServiceName ?? null)},
				${toSqlValue(request.action)},
				${toSqlValue(request.reason)},
				${toSqlValue(json(request.metadata ?? {}))},
				${toSqlValue(timestamp)}
			)`,
		);
		const row = await this.selectFirst(`SELECT * FROM runner_scale_decisions WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? runnerScaleDecisionFromRow(row) : null;
	}

	async listRunnerScaleDecisions(projectId: string, environment: string, workDayId?: string | null) {
		if (!(await this.tableExists('runner_scale_decisions'))) return [];
		const rows = await this.selectAll(
			`SELECT * FROM runner_scale_decisions WHERE project_id = ${toSqlValue(projectId)} AND environment = ${toSqlValue(environment)}${workDayId ? ` AND work_day_id = ${toSqlValue(workDayId)}` : ''} ORDER BY created_at DESC`,
		);
		return rows.map(runnerScaleDecisionFromRow);
	}

	async updateWorkDayGraph(request: SdkUpdateWorkDayGraphRequest) {
		const existing = await this.getWorkDay(request.id);
		if (!existing) return null;
		const currentSummary = parseJsonValue<Record<string, unknown>>(existing.summaryJson, {});
		const timestamp = nowIso();
		await this.execute(
			`UPDATE work_days SET graph_version = ${toSqlValue(request.graphVersion)}, summary_json = ${toSqlValue(json({ ...currentSummary, ...(request.summaryPatch ?? {}) }))}, updated_at = ${toSqlValue(timestamp)} WHERE id = ${toSqlValue(request.id)}`,
		);
		return this.getWorkDay(request.id);
	}

	async listPriorityOverrides(projectId: string) {
		if (!(await this.tableExists('priority_overrides'))) {
			return [];
		}
		return this.selectAll(
			`SELECT * FROM priority_overrides WHERE project_id = ${toSqlValue(projectId)} ORDER BY priority DESC, updated_at DESC`,
		);
	}

	async upsertPriorityOverride(request: SdkPriorityOverrideRequest) {
		const id = request.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT OR REPLACE INTO priority_overrides (
				id, project_id, model, subject_id, priority, estimated_credits, metadata_json, created_at, updated_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(request.projectId)},
				${toSqlValue(request.model)},
				${toSqlValue(request.subjectId)},
				${Number(request.priority ?? 0)},
				${toSqlValue(request.estimatedCredits ?? null)},
				${toSqlValue(json(request.metadata ?? {}))},
				COALESCE((SELECT created_at FROM priority_overrides WHERE id = ${toSqlValue(id)}), ${toSqlValue(timestamp)}),
				${toSqlValue(timestamp)}
			)`,
		);
		const row = await this.selectFirst(`SELECT * FROM priority_overrides WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? {
			id: String(row.id ?? ''),
			projectId: String(row.project_id ?? ''),
			model: String(row.model ?? ''),
			subjectId: String(row.subject_id ?? ''),
			priority: Number(row.priority ?? 0),
			estimatedCredits: row.estimated_credits === null || row.estimated_credits === undefined ? null : Number(row.estimated_credits),
			metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json, {}),
			createdAt: String(row.created_at ?? timestamp),
			updatedAt: String(row.updated_at ?? timestamp),
		} : null;
	}

	async createPrioritySnapshot(request: SdkCreatePrioritySnapshotRequest) {
		const id = request.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT OR REPLACE INTO priority_snapshots (
				id, project_id, work_day_id, snapshot_json, metadata_json, generated_at, created_at, updated_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(request.projectId)},
				${toSqlValue(request.workDayId ?? null)},
				${toSqlValue(json({ items: request.items }))},
				${toSqlValue(json(request.metadata ?? {}))},
				${toSqlValue(timestamp)},
				COALESCE((SELECT created_at FROM priority_snapshots WHERE id = ${toSqlValue(id)}), ${toSqlValue(timestamp)}),
				${toSqlValue(timestamp)}
			)`,
		);
		const row = await this.selectFirst(`SELECT * FROM priority_snapshots WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? prioritySnapshotFromRow(row) : null;
	}

	async getLatestPrioritySnapshot(projectId: string, workDayId?: string | null) {
		if (!(await this.tableExists('priority_snapshots'))) {
			return null;
		}
		const row = await this.selectFirst(
			`SELECT * FROM priority_snapshots WHERE project_id = ${toSqlValue(projectId)}${workDayId ? ` AND work_day_id = ${toSqlValue(workDayId)}` : ''} ORDER BY generated_at DESC LIMIT 1`,
		);
		return row ? prioritySnapshotFromRow(row) : null;
	}

	async recordTaskCredits(request: SdkRecordTaskCreditsRequest) {
		const id = request.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT INTO task_credit_ledger (
				id, project_id, work_day_id, task_id, phase, credits, metadata_json, created_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(request.projectId)},
				${toSqlValue(request.workDayId)},
				${toSqlValue(request.taskId ?? null)},
				${toSqlValue(request.phase)},
				${Number(request.credits ?? 0)},
				${toSqlValue(json(request.metadata ?? {}))},
				${toSqlValue(timestamp)}
			)`,
		);
		const delta = request.phase === 'refund' ? -Math.abs(Number(request.credits ?? 0)) : Math.abs(Number(request.credits ?? 0));
		await this.execute(
			`UPDATE work_days SET capacity_used = MAX(0, capacity_used + ${delta}), updated_at = ${toSqlValue(timestamp)} WHERE id = ${toSqlValue(request.workDayId)}`,
		);
		const row = await this.selectFirst(`SELECT * FROM task_credit_ledger WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? taskCreditLedgerEntryFromRow(row) : null;
	}

	async listTaskCredits(workDayId: string) {
		if (!(await this.tableExists('task_credit_ledger'))) {
			return [];
		}
		const rows = await this.selectAll(
			`SELECT * FROM task_credit_ledger WHERE work_day_id = ${toSqlValue(workDayId)} ORDER BY created_at ASC`,
		);
		return rows.map(taskCreditLedgerEntryFromRow);
	}

	async recordScaleDecision(request: SdkRecordScaleDecisionRequest) {
		const id = request.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT INTO scale_decisions (
				id, project_id, environment, pool_name, work_day_id, desired_workers, observed_queue_depth, observed_active_leases, reason, metadata_json, created_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(request.projectId)},
				${toSqlValue(request.environment)},
				${toSqlValue(request.poolName)},
				${toSqlValue(request.workDayId ?? null)},
				${Number(request.desiredWorkers ?? 0)},
				${Number(request.observedQueueDepth ?? 0)},
				${Number(request.observedActiveLeases ?? 0)},
				${toSqlValue(request.reason)},
				${toSqlValue(json(request.metadata ?? {}))},
				${toSqlValue(timestamp)}
			)`,
		);
		const row = await this.selectFirst(`SELECT * FROM scale_decisions WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? scaleDecisionFromRow(row) : null;
	}

	async getLatestScaleDecision(projectId: string, environment: string, poolName: string) {
		if (!(await this.tableExists('scale_decisions'))) {
			return null;
		}
		const row = await this.selectFirst(
			`SELECT * FROM scale_decisions WHERE project_id = ${toSqlValue(projectId)} AND environment = ${toSqlValue(environment)} AND pool_name = ${toSqlValue(poolName)} ORDER BY created_at DESC LIMIT 1`,
		);
		return row ? scaleDecisionFromRow(row) : null;
	}

	async createApprovalRequest(request: CreateApprovalRequestRequest) {
		await this.ensureGovernanceSchema();
		const id = request.id ?? crypto.randomUUID();
		const existing = await this.selectFirst(`SELECT * FROM approval_requests WHERE id = ${toSqlValue(id)} LIMIT 1`);
		if (existing && String(existing.state ?? 'pending') !== 'pending') {
			return approvalRequestFromRow(existing);
		}
		const timestamp = nowIso();
		await this.execute(
			`INSERT OR REPLACE INTO approval_requests (
				id, team_id, project_id, work_day_id, task_id, kind, state, severity, requested_by_type,
				requested_by_id, title, summary, options_json, recommendation_json, policy_snapshot_json,
				expires_at, decided_by_type, decided_by_id, decided_at, decision_json, metadata_json, created_at, updated_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(request.teamId)},
				${toSqlValue(request.projectId)},
				${toSqlValue(request.workDayId ?? null)},
				${toSqlValue(request.taskId ?? null)},
				${toSqlValue(request.kind)},
				${toSqlValue(existing?.state ?? 'pending')},
				${toSqlValue(request.severity ?? existing?.severity ?? 'medium')},
				${toSqlValue(request.requestedByType ?? existing?.requested_by_type ?? 'worker')},
				${toSqlValue(request.requestedById ?? existing?.requested_by_id ?? null)},
				${toSqlValue(request.title)},
				${toSqlValue(request.summary)},
				${toSqlValue(json(request.options ?? parseJsonValue(existing?.options_json, [])))},
				${toSqlValue(json(request.recommendation ?? parseJsonValue(existing?.recommendation_json, {})))},
				${toSqlValue(json(request.policySnapshot ?? parseJsonValue(existing?.policy_snapshot_json, {})))},
				${toSqlValue(request.expiresAt ?? existing?.expires_at ?? null)},
				${toSqlValue(existing?.decided_by_type ?? null)},
				${toSqlValue(existing?.decided_by_id ?? null)},
				${toSqlValue(existing?.decided_at ?? null)},
				${toSqlValue(existing?.decision_json ?? null)},
				${toSqlValue(json(request.metadata ?? parseJsonValue(existing?.metadata_json, {})))},
				COALESCE((SELECT created_at FROM approval_requests WHERE id = ${toSqlValue(id)}), ${toSqlValue(timestamp)}),
				${toSqlValue(timestamp)}
			)`,
		);
		const row = await this.selectFirst(`SELECT * FROM approval_requests WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? approvalRequestFromRow(row) : null;
	}

	async listApprovalRequests(request: ListApprovalRequestsRequest = {}) {
		await this.ensureGovernanceSchema();
		const clauses: string[] = [];
		if (request.projectId) clauses.push(`project_id = ${toSqlValue(request.projectId)}`);
		if (request.teamId) clauses.push(`team_id = ${toSqlValue(request.teamId)}`);
		if (request.state) {
			const states = Array.isArray(request.state) ? request.state : [request.state];
			clauses.push(`state IN (${states.map((entry) => toSqlValue(String(entry))).join(', ')})`);
		}
		const rows = await this.selectAll(
			`SELECT * FROM approval_requests ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(500, Number(request.limit ?? 100)))}`,
		);
		return rows.map(approvalRequestFromRow);
	}

	async decideApprovalRequest(id: string, request: DecideApprovalRequestRequest) {
		await this.ensureGovernanceSchema();
		const existing = await this.selectFirst(`SELECT * FROM approval_requests WHERE id = ${toSqlValue(id)} LIMIT 1`);
		if (!existing) return null;
		const timestamp = nowIso();
		const decision = {
			...(request.decision ?? {}),
			...(request.optionId ? { optionId: request.optionId } : {}),
			...(request.note ? { note: request.note } : {}),
		};
		await this.execute(
			`UPDATE approval_requests
			 SET state = ${toSqlValue(String(request.state || 'pending'))},
			 decided_by_type = ${toSqlValue(request.decidedByType ?? 'user')},
			 decided_by_id = ${toSqlValue(request.decidedById ?? null)},
			 decided_at = ${toSqlValue(timestamp)},
			 decision_json = ${toSqlValue(json(decision))},
			 updated_at = ${toSqlValue(timestamp)}
			 WHERE id = ${toSqlValue(id)}`,
		);
		const row = await this.selectFirst(`SELECT * FROM approval_requests WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? approvalRequestFromRow(row) : null;
	}

	async upsertTeamInboxItem(request: UpsertTeamInboxItemRequest) {
		await this.ensureGovernanceSchema();
		const id = request.id ?? request.itemKey ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT OR REPLACE INTO team_inbox_items (
				id, team_id, project_id, kind, state, title, summary, href, item_key, metadata_json, created_at, updated_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(request.teamId)},
				${toSqlValue(request.projectId ?? null)},
				${toSqlValue(request.kind)},
				${toSqlValue(request.state)},
				${toSqlValue(request.title)},
				${toSqlValue(request.summary ?? null)},
				${toSqlValue(request.href ?? null)},
				${toSqlValue(request.itemKey ?? null)},
				${toSqlValue(json(request.metadata ?? {}))},
				COALESCE((SELECT created_at FROM team_inbox_items WHERE id = ${toSqlValue(id)}), ${toSqlValue(timestamp)}),
				${toSqlValue(timestamp)}
			)`,
		);
		const row = await this.selectFirst(`SELECT * FROM team_inbox_items WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? teamInboxItemFromRow(row) : null;
	}
}
