import crypto from 'node:crypto';
import type {
	SdkAppendTaskEventRequest,
	SdkClaimTaskRequest,
	SdkCloseWorkDayRequest,
	SdkCompleteTaskRequest,
	SdkCreateReportRequest,
	SdkCreateTaskRequest,
	SdkFailTaskRequest,
	SdkGraphRunEntity,
	SdkReportEntity,
	SdkStartWorkDayRequest,
	SdkTaskEntity,
	SdkTaskEventEntity,
	SdkTaskOutputEntity,
	SdkTaskProgressRequest,
	SdkTaskSearchRequest,
	SdkWorkDayEntity,
} from '../sdk-types.ts';
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

export class OperationalStore extends SqliteStoreBase {
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

	async listTaskOutputs(taskId: string) {
		const rows = await this.selectAll(
			`SELECT * FROM task_outputs WHERE task_id = ${toSqlValue(taskId)} ORDER BY created_at ASC`,
		);
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
}
