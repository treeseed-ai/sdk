import crypto from 'node:crypto';
import type {
	ApprovalRequest,
	CreateApprovalRequestRequest,
	DecideApprovalRequestRequest,
	ListApprovalRequestsRequest,
	UpsertTeamInboxItemRequest,
} from '../sdk-types.ts';
import type { InboxItem } from '../project-workflow.ts';
import { SqliteStoreBase, nowIso, toSqlValue, type DatabaseRow } from './helpers.ts';

function json(value: unknown) {
	return JSON.stringify(value ?? {});
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
