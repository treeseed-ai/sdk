import type {
	SdkRecordRunRequest,
	SdkRunEntity,
	SdkSearchRequest,
	SdkUpdateRequest,
} from '../sdk-types.ts';
import { SqliteStoreBase, nowIso, toSqlValue } from './helpers.ts';
import { createRunEnvelope, runEntityFromEnvelope, TRESEED_ENVELOPE_SCHEMA_VERSION } from './envelopes.ts';

export function runFromRecord(row: Record<string, unknown>): SdkRunEntity {
	return {
		runId: String(row.runId ?? row.run_id ?? ''),
		agentSlug: String(row.agentSlug ?? row.agent_slug ?? ''),
		triggerSource: String(row.triggerSource ?? row.trigger_source ?? ''),
		status: String(row.status ?? ''),
		selectedItemKey: row.selectedItemKey !== undefined && row.selectedItemKey !== null ? String(row.selectedItemKey) : row.selected_item_key !== undefined && row.selected_item_key !== null ? String(row.selected_item_key) : null,
		selectedMessageId: row.selectedMessageId !== undefined && row.selectedMessageId !== null ? Number(row.selectedMessageId) : row.selected_message_id !== undefined && row.selected_message_id !== null ? Number(row.selected_message_id) : null,
		branchName: row.branchName !== undefined && row.branchName !== null ? String(row.branchName) : row.branch_name !== undefined && row.branch_name !== null ? String(row.branch_name) : null,
		prUrl: row.prUrl !== undefined && row.prUrl !== null ? String(row.prUrl) : row.pr_url !== undefined && row.pr_url !== null ? String(row.pr_url) : null,
		summary: row.summary !== undefined && row.summary !== null ? String(row.summary) : null,
		error: row.error !== undefined && row.error !== null ? String(row.error) : null,
		startedAt: String(row.startedAt ?? row.started_at ?? nowIso()),
		finishedAt: row.finishedAt !== undefined && row.finishedAt !== null ? String(row.finishedAt) : row.finished_at !== undefined && row.finished_at !== null ? String(row.finished_at) : null,
		errorCategory: row.errorCategory !== undefined && row.errorCategory !== null ? String(row.errorCategory) : row.error_category !== undefined && row.error_category !== null ? String(row.error_category) : null,
		handlerKind: row.handlerKind !== undefined && row.handlerKind !== null ? String(row.handlerKind) : row.handler_kind !== undefined && row.handler_kind !== null ? String(row.handler_kind) : null,
		triggerKind: row.triggerKind !== undefined && row.triggerKind !== null ? String(row.triggerKind) : row.trigger_kind !== undefined && row.trigger_kind !== null ? String(row.trigger_kind) : null,
		claimedMessageId: row.claimedMessageId !== undefined && row.claimedMessageId !== null ? Number(row.claimedMessageId) : row.claimed_message_id !== undefined && row.claimed_message_id !== null ? Number(row.claimed_message_id) : null,
		commitSha: row.commitSha !== undefined && row.commitSha !== null ? String(row.commitSha) : row.commit_sha !== undefined && row.commit_sha !== null ? String(row.commit_sha) : null,
		changedPaths: Array.isArray(row.changedPaths) ? row.changedPaths.map(String) : row.changed_paths ? JSON.parse(String(row.changed_paths)) : [],
	};
}

export class RunStore extends SqliteStoreBase {
	private async usesEnvelopeTable() {
		return this.tableExists('runtime_records');
	}

	async getByKey(key: string) {
		if (await this.usesEnvelopeTable()) {
			const row = await this.selectFirst(
				`SELECT * FROM runtime_records WHERE record_type = 'agent_run' AND record_key = ${toSqlValue(key)} LIMIT 1`,
			);
			return row ? runEntityFromEnvelope(row) : null;
		}
		const row = await this.selectFirst(
			`SELECT * FROM agent_runs WHERE run_id = ${toSqlValue(key)} LIMIT 1`,
		);
		return row ? runFromRecord(row) : null;
	}

	async search(request: SdkSearchRequest) {
		if (await this.usesEnvelopeTable()) {
			const where =
				request.filters?.length
					? `AND ${request.filters
						.map((filter) => {
							const field = runFilterColumn(filter.field);
							switch (filter.op) {
								case 'eq':
									return `${field} = ${toSqlValue(filter.value)}`;
								case 'in':
									return `${field} IN (${(Array.isArray(filter.value) ? filter.value : [filter.value]).map(toSqlValue).join(', ')})`;
								case 'updated_since':
									return `created_at >= ${toSqlValue(filter.value)}`;
								default:
									return `${field} LIKE ${toSqlValue(`%${String(filter.value ?? '')}%`)}`;
							}
						})
						.join(' AND ')}`
					: '';
			const order =
				request.sort?.length
					? `ORDER BY ${request.sort.map((entry) => `${runSortColumn(entry.field)} ${entry.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`
					: '';
			const limit = request.limit ? `LIMIT ${request.limit}` : '';
			const rows = await this.selectAll(['SELECT * FROM runtime_records WHERE record_type = \'agent_run\'', where, order, limit].filter(Boolean).join(' '));
			return rows.map(runEntityFromEnvelope);
		}
		const where =
			request.filters?.length
				? `WHERE ${request.filters
					.map((filter) => {
						switch (filter.op) {
							case 'eq':
								return `${filter.field} = ${toSqlValue(filter.value)}`;
							case 'in':
								return `${filter.field} IN (${(Array.isArray(filter.value) ? filter.value : [filter.value]).map(toSqlValue).join(', ')})`;
							case 'updated_since':
								return `started_at >= ${toSqlValue(filter.value)}`;
							default:
								return `${filter.field} LIKE ${toSqlValue(`%${String(filter.value ?? '')}%`)}`;
						}
					})
					.join(' AND ')}`
				: '';
		const order =
			request.sort?.length
				? `ORDER BY ${request.sort.map((entry) => `${entry.field} ${entry.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`
				: '';
		const limit = request.limit ? `LIMIT ${request.limit}` : '';
		const rows = await this.selectAll(['SELECT * FROM agent_runs', where, order, limit].filter(Boolean).join(' '));
		return rows.map(runFromRecord);
	}

	async record(request: SdkRecordRunRequest) {
		const run = runFromRecord(request.run);
		if (await this.usesEnvelopeTable()) {
			const envelope = createRunEnvelope({
				runId: run.runId,
				agentSlug: run.agentSlug,
				status: run.status,
				triggerSource: run.triggerSource,
				startedAt: run.startedAt,
				handlerKind: run.handlerKind ?? null,
				triggerKind: run.triggerKind ?? null,
				selectedItemKey: run.selectedItemKey ?? null,
				selectedMessageId: run.selectedMessageId ?? null,
				claimedMessageId: run.claimedMessageId ?? null,
				branchName: run.branchName ?? null,
				prUrl: run.prUrl ?? null,
				summary: run.summary ?? null,
				error: run.error ?? null,
				errorCategory: run.errorCategory ?? null,
				commitSha: run.commitSha ?? null,
				changedPaths: run.changedPaths ?? [],
				finishedAt: run.finishedAt ?? null,
			});
			await this.execute(
				`INSERT OR REPLACE INTO runtime_records (record_type, record_key, lookup_key, secondary_key, status, schema_version, created_at, updated_at, payload_json, meta_json) VALUES ('agent_run', ${toSqlValue(run.runId)}, ${toSqlValue(run.agentSlug)}, ${toSqlValue(run.commitSha ?? null)}, ${toSqlValue(run.status)}, ${TRESEED_ENVELOPE_SCHEMA_VERSION}, ${toSqlValue(run.startedAt)}, ${toSqlValue(run.finishedAt ?? run.startedAt)}, ${toSqlValue(JSON.stringify(envelope.payload))}, ${toSqlValue(JSON.stringify(envelope.meta))})`,
			);
			return this.getByKey(run.runId) as Promise<SdkRunEntity>;
		}
		await this.execute(
			`INSERT OR REPLACE INTO agent_runs (run_id, agent_slug, handler_kind, trigger_kind, trigger_source, claimed_message_id, status, selected_item_key, selected_message_id, branch_name, pr_url, summary, error, error_category, commit_sha, changed_paths, started_at, finished_at) VALUES (${toSqlValue(run.runId)}, ${toSqlValue(run.agentSlug)}, ${toSqlValue(run.handlerKind ?? null)}, ${toSqlValue(run.triggerKind ?? null)}, ${toSqlValue(run.triggerSource)}, ${toSqlValue(run.claimedMessageId ?? null)}, ${toSqlValue(run.status)}, ${toSqlValue(run.selectedItemKey)}, ${toSqlValue(run.selectedMessageId)}, ${toSqlValue(run.branchName)}, ${toSqlValue(run.prUrl)}, ${toSqlValue(run.summary)}, ${toSqlValue(run.error)}, ${toSqlValue(run.errorCategory ?? null)}, ${toSqlValue(run.commitSha ?? null)}, ${toSqlValue(JSON.stringify(run.changedPaths ?? []))}, ${toSqlValue(run.startedAt)}, ${toSqlValue(run.finishedAt)})`,
		);
		return run;
	}

	async update(request: SdkUpdateRequest) {
		return this.record({
			run: {
				...request.data,
				runId: request.data.runId ?? request.id ?? request.key,
			},
		});
	}
}

function runFilterColumn(field: string) {
	switch (field) {
		case 'runId':
		case 'run_id':
			return 'record_key';
		case 'agentSlug':
		case 'agent_slug':
			return 'lookup_key';
		case 'status':
			return 'status';
		case 'commitSha':
		case 'commit_sha':
			return 'secondary_key';
		case 'startedAt':
		case 'started_at':
			return 'created_at';
		case 'finishedAt':
		case 'finished_at':
			return "json_extract(payload_json, '$.finishedAt')";
		default:
			return `json_extract(payload_json, '$.${field}')`;
	}
}

function runSortColumn(field: string) {
	switch (field) {
		case 'runId':
		case 'run_id':
			return 'record_key';
		case 'agentSlug':
		case 'agent_slug':
			return 'lookup_key';
		case 'startedAt':
		case 'started_at':
			return 'created_at';
		case 'commitSha':
		case 'commit_sha':
			return 'secondary_key';
		case 'status':
			return 'status';
		default:
			return 'created_at';
	}
}
