import type {
	SdkCursorEntity,
	SdkCursorRequest,
	SdkGetCursorRequest,
	SdkSearchRequest,
	SdkUpdateRequest,
} from '../sdk-types.ts';
import { assertExpectedVersion } from '../sdk-version.ts';
import { SqliteStoreBase, nowIso, toSqlValue } from './helpers.ts';
import { createCursorEnvelope, cursorEntityFromEnvelope, TRESEED_ENVELOPE_SCHEMA_VERSION } from './envelopes.ts';

function cursorFromRow(row: Record<string, unknown>): SdkCursorEntity {
	return {
		agentSlug: String(row.agentSlug ?? row.agent_slug ?? ''),
		cursorKey: String(row.cursorKey ?? row.cursor_key ?? ''),
		cursorValue: String(row.cursorValue ?? row.cursor_value ?? ''),
		updatedAt:
			row.updatedAt !== undefined && row.updatedAt !== null
				? String(row.updatedAt)
				: row.updated_at !== undefined && row.updated_at !== null
					? String(row.updated_at)
					: null,
	};
}

function buildFilterSql(filters: SdkSearchRequest['filters'] = []) {
	return filters?.length
		? `WHERE ${filters
			.map((filter) => {
				switch (filter.op) {
					case 'eq':
						return `${filter.field} = ${toSqlValue(filter.value)}`;
					case 'in':
						return `${filter.field} IN (${(Array.isArray(filter.value) ? filter.value : [filter.value]).map(toSqlValue).join(', ')})`;
					case 'updated_since':
						return `${filter.field} >= ${toSqlValue(filter.value)}`;
					default:
						return `${filter.field} LIKE ${toSqlValue(`%${String(filter.value ?? '')}%`)}`;
				}
			})
			.join(' AND ')}`
		: '';
}

export class CursorStore extends SqliteStoreBase {
	private async usesEnvelopeTable() {
		return this.tableExists('cursor_state');
	}

	async getByKey(key: string) {
		const [agentSlug, cursorKey] = key.split(':', 2);
		if (!agentSlug || !cursorKey) {
			return null;
		}
		if (await this.usesEnvelopeTable()) {
			const row = await this.selectFirst(
				`SELECT * FROM cursor_state WHERE agent_slug = ${toSqlValue(agentSlug)} AND cursor_key = ${toSqlValue(cursorKey)} LIMIT 1`,
			);
			return row ? cursorEntityFromEnvelope(row) : null;
		}
		const row = await this.selectFirst(
			`SELECT * FROM agent_cursors WHERE agent_slug = ${toSqlValue(agentSlug)} AND cursor_key = ${toSqlValue(cursorKey)} LIMIT 1`,
		);
		return row ? cursorFromRow(row) : null;
	}

	async get(request: SdkGetCursorRequest) {
		if (await this.usesEnvelopeTable()) {
			const row = await this.selectFirst(
				`SELECT payload_json FROM cursor_state WHERE agent_slug = ${toSqlValue(request.agentSlug)} AND cursor_key = ${toSqlValue(request.cursorKey)} LIMIT 1`,
			);
			if (typeof row?.payload_json !== 'string') {
				return null;
			}
			try {
				return String((JSON.parse(row.payload_json) as { cursorValue?: string }).cursorValue ?? '');
			} catch {
				return null;
			}
		}
		const row = await this.selectFirst(
			`SELECT cursor_value FROM agent_cursors WHERE agent_slug = ${toSqlValue(request.agentSlug)} AND cursor_key = ${toSqlValue(request.cursorKey)} LIMIT 1`,
		);
		return row?.cursor_value !== undefined && row?.cursor_value !== null ? String(row.cursor_value) : null;
	}

	async search(request: SdkSearchRequest) {
		if (await this.usesEnvelopeTable()) {
			const sql = [
				'SELECT * FROM cursor_state',
				buildEnvelopeFilterSql(request.filters),
				request.sort?.length
					? `ORDER BY ${request.sort.map((entry) => `${cursorSortColumn(entry.field)} ${entry.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`
					: '',
				request.limit ? `LIMIT ${request.limit}` : '',
			].filter(Boolean).join(' ');
			const rows = await this.selectAll(sql);
			return rows.map(cursorEntityFromEnvelope);
		}
		const sql = [
			'SELECT * FROM agent_cursors',
			buildFilterSql(request.filters),
			request.sort?.length
				? `ORDER BY ${request.sort.map((entry) => `${entry.field} ${entry.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`
				: '',
			request.limit ? `LIMIT ${request.limit}` : '',
		].filter(Boolean).join(' ');
		const rows = await this.selectAll(sql);
		return rows.map(cursorFromRow);
	}

	async upsert(request: SdkCursorRequest) {
		if (await this.usesEnvelopeTable()) {
			const envelope = createCursorEnvelope({
				agentSlug: request.agentSlug,
				cursorKey: request.cursorKey,
				cursorValue: request.cursorValue,
			});
			await this.execute(
				`INSERT OR REPLACE INTO cursor_state (agent_slug, cursor_key, status, schema_version, updated_at, payload_json, meta_json) VALUES (${toSqlValue(request.agentSlug)}, ${toSqlValue(request.cursorKey)}, ${toSqlValue(envelope.status)}, ${TRESEED_ENVELOPE_SCHEMA_VERSION}, ${toSqlValue(nowIso())}, ${toSqlValue(JSON.stringify(envelope.payload))}, ${toSqlValue(JSON.stringify(envelope.meta))})`,
			);
			return;
		}
		await this.execute(
			`INSERT OR REPLACE INTO agent_cursors (agent_slug, cursor_key, cursor_value, updated_at) VALUES (${toSqlValue(request.agentSlug)}, ${toSqlValue(request.cursorKey)}, ${toSqlValue(request.cursorValue)}, ${toSqlValue(nowIso())})`,
		);
	}

	async update(request: SdkUpdateRequest) {
		const agentSlug = String(request.data.agentSlug ?? request.id ?? request.key ?? '');
		const cursorKey = String(request.data.cursorKey ?? request.slug ?? '');
		const cursorValue = String(request.data.cursorValue ?? '');
		assertExpectedVersion(
			request.expectedVersion,
			await this.getByKey(`${agentSlug}:${cursorKey}`),
			`agent_cursor "${agentSlug}:${cursorKey}"`,
		);
		await this.upsert({
			agentSlug,
			cursorKey,
			cursorValue,
		});
		return this.getByKey(`${agentSlug}:${cursorKey}`);
	}
}

function buildEnvelopeFilterSql(filters: SdkSearchRequest['filters'] = []) {
	return filters?.length
		? `WHERE ${filters
			.map((filter) => {
				const field = cursorFilterColumn(filter.field);
				switch (filter.op) {
					case 'eq':
						return `${field} = ${toSqlValue(filter.value)}`;
					case 'in':
						return `${field} IN (${(Array.isArray(filter.value) ? filter.value : [filter.value]).map(toSqlValue).join(', ')})`;
					case 'updated_since':
						return `updated_at >= ${toSqlValue(filter.value)}`;
					default:
						return `${field} LIKE ${toSqlValue(`%${String(filter.value ?? '')}%`)}`;
				}
			})
			.join(' AND ')}`
		: '';
}

function cursorFilterColumn(field: string) {
	switch (field) {
		case 'agentSlug':
		case 'agent_slug':
			return 'agent_slug';
		case 'cursorKey':
		case 'cursor_key':
			return 'cursor_key';
		case 'updatedAt':
		case 'updated_at':
			return 'updated_at';
		default:
			return `json_extract(payload_json, '$.${field}')`;
	}
}

function cursorSortColumn(field: string) {
	switch (field) {
		case 'agentSlug':
		case 'agent_slug':
			return 'agent_slug';
		case 'cursorKey':
		case 'cursor_key':
			return 'cursor_key';
		case 'updatedAt':
		case 'updated_at':
		default:
			return 'updated_at';
	}
}
