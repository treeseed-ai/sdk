import type {
	SdkRecordRunRequest,
	SdkRunEntity,
	SdkSearchRequest,
	SdkUpdateRequest,
} from '../sdk-types.ts';
import { assertExpectedVersion } from '../sdk-version.ts';
import { SqliteStoreBase, nowIso, toSqlValue } from './helpers.ts';

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
	async getByKey(key: string) {
		const row = await this.selectFirst(
			`SELECT * FROM agent_runs WHERE run_id = ${toSqlValue(key)} LIMIT 1`,
		);
		return row ? runFromRecord(row) : null;
	}

	async search(request: SdkSearchRequest) {
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
		await this.execute(
			`INSERT OR REPLACE INTO agent_runs (run_id, agent_slug, handler_kind, trigger_kind, trigger_source, claimed_message_id, status, selected_item_key, selected_message_id, branch_name, pr_url, summary, error, error_category, commit_sha, changed_paths, started_at, finished_at) VALUES (${toSqlValue(run.runId)}, ${toSqlValue(run.agentSlug)}, ${toSqlValue(run.handlerKind ?? null)}, ${toSqlValue(run.triggerKind ?? null)}, ${toSqlValue(run.triggerSource)}, ${toSqlValue(run.claimedMessageId ?? null)}, ${toSqlValue(run.status)}, ${toSqlValue(run.selectedItemKey)}, ${toSqlValue(run.selectedMessageId)}, ${toSqlValue(run.branchName)}, ${toSqlValue(run.prUrl)}, ${toSqlValue(run.summary)}, ${toSqlValue(run.error)}, ${toSqlValue(run.errorCategory ?? null)}, ${toSqlValue(run.commitSha ?? null)}, ${toSqlValue(JSON.stringify(run.changedPaths ?? []))}, ${toSqlValue(run.startedAt)}, ${toSqlValue(run.finishedAt)})`,
		);
		return run;
	}

	async update(request: SdkUpdateRequest) {
		const runId = String(request.data.run_id ?? request.data.runId ?? request.id ?? request.key ?? '');
		assertExpectedVersion(
			request.expectedVersion,
			runId ? await this.getByKey(runId) : null,
			`agent_run "${runId}"`,
		);
		return this.record({
			run: {
				...request.data,
				runId,
			},
		});
	}
}
