import type {
	SdkAckMessageRequest,
	SdkClaimMessageRequest,
	SdkCreateMessageRequest,
	SdkMessageEntity,
	SdkSearchRequest,
	SdkUpdateRequest,
} from '../sdk-types.ts';
import { assertExpectedVersion } from '../sdk-version.ts';
import { SqliteStoreBase, nowIso, toSqlValue, type DatabaseRow } from './helpers.ts';
import { createMessageEnvelope, messageEntityFromEnvelope, TRESEED_ENVELOPE_SCHEMA_VERSION } from './envelopes.ts';

export function messageFromRow(row: DatabaseRow): SdkMessageEntity {
	return {
		id: Number(row.id),
		type: String(row.type ?? ''),
		status: String(row.status ?? 'pending'),
		payloadJson: String(row.payload_json ?? row.payloadJson ?? '{}'),
		relatedModel: row.related_model ? String(row.related_model) : row.relatedModel ? String(row.relatedModel) : null,
		relatedId: row.related_id ? String(row.related_id) : row.relatedId ? String(row.relatedId) : null,
		priority: Number(row.priority ?? 0),
		availableAt: String(row.available_at ?? row.availableAt ?? nowIso()),
		claimedBy: row.claimed_by ? String(row.claimed_by) : row.claimedBy ? String(row.claimedBy) : null,
		claimedAt: row.claimed_at ? String(row.claimed_at) : row.claimedAt ? String(row.claimedAt) : null,
		leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : row.leaseExpiresAt ? String(row.leaseExpiresAt) : null,
		attempts: Number(row.attempts ?? 0),
		maxAttempts: Number(row.max_attempts ?? row.maxAttempts ?? 3),
		createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
		updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
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

function buildOrderSql(sort: SdkSearchRequest['sort'] = []) {
	return sort?.length
		? `ORDER BY ${sort.map((entry) => `${entry.field} ${entry.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`
		: '';
}

function claimOrderSql(strategy?: 'latest' | 'highest_priority' | 'oldest') {
	switch (strategy) {
		case 'oldest':
			return 'ORDER BY available_at ASC, priority DESC';
		case 'latest':
			return 'ORDER BY available_at DESC, priority DESC';
		case 'highest_priority':
		default:
			return 'ORDER BY priority DESC, available_at ASC';
	}
}

export class MessageStore extends SqliteStoreBase {
	private async usesEnvelopeTable() {
		return this.tableExists('message_queue');
	}

	async getById(id: number) {
		if (await this.usesEnvelopeTable()) {
			const row = await this.selectFirst(`SELECT * FROM message_queue WHERE id = ${id} LIMIT 1`);
			return row ? messageEntityFromEnvelope(row) : null;
		}
		const row = await this.selectFirst(`SELECT * FROM messages WHERE id = ${id} LIMIT 1`);
		return row ? messageFromRow(row) : null;
	}

	async search(request: SdkSearchRequest) {
		if (await this.usesEnvelopeTable()) {
			const sql = [
				'SELECT * FROM message_queue',
				buildEnvelopeFilterSql(request.filters),
				buildEnvelopeOrderSql(request.sort),
				request.limit ? `LIMIT ${request.limit}` : '',
			].filter(Boolean).join(' ');
			const rows = await this.selectAll(sql);
			return rows.map(messageEntityFromEnvelope);
		}
		const sql = [
			'SELECT * FROM messages',
			buildFilterSql(request.filters),
			buildOrderSql(request.sort),
			request.limit ? `LIMIT ${request.limit}` : '',
		].filter(Boolean).join(' ');
		const rows = await this.selectAll(sql);
		return rows.map(messageFromRow);
	}

	async claim(request: SdkClaimMessageRequest, strategy: 'latest' | 'highest_priority' | 'oldest' = 'highest_priority') {
		if (await this.usesEnvelopeTable()) {
			const typeClause = request.messageTypes?.length
				? ` AND message_type IN (${request.messageTypes.map(toSqlValue).join(', ')})`
				: '';
			const row = await this.selectFirst(
				`SELECT * FROM message_queue WHERE status IN ('pending', 'failed') AND available_at <= ${toSqlValue(nowIso())}${typeClause} ${claimOrderSql(strategy)} LIMIT 1`,
			);
			if (!row) {
				return null;
			}
			const id = Number(row.id);
			const claimedAt = nowIso();
			await this.execute(
				`UPDATE message_queue SET status = 'claimed', claimed_by = ${toSqlValue(request.workerId)}, claimed_at = ${toSqlValue(claimedAt)}, lease_expires_at = ${toSqlValue(new Date(Date.now() + request.leaseSeconds * 1000).toISOString())}, attempts = attempts + 1, updated_at = ${toSqlValue(claimedAt)} WHERE id = ${id} AND status IN ('pending', 'failed')`,
			);
			return this.getById(id);
		}
		const typeClause = request.messageTypes?.length
			? ` AND type IN (${request.messageTypes.map(toSqlValue).join(', ')})`
			: '';
		const row = await this.selectFirst(
			`SELECT * FROM messages WHERE status IN ('pending', 'failed') AND available_at <= ${toSqlValue(nowIso())}${typeClause} ${claimOrderSql(strategy)} LIMIT 1`,
		);
		if (!row) {
			return null;
		}
		const id = Number(row.id);
		const claimedAt = nowIso();
		await this.execute(
			`UPDATE messages SET status = 'claimed', claimed_by = ${toSqlValue(request.workerId)}, claimed_at = ${toSqlValue(claimedAt)}, lease_expires_at = ${toSqlValue(new Date(Date.now() + request.leaseSeconds * 1000).toISOString())}, attempts = attempts + 1, updated_at = ${toSqlValue(claimedAt)} WHERE id = ${id} AND status IN ('pending', 'failed')`,
		);
		return this.getById(id);
	}

	async ack(request: SdkAckMessageRequest) {
		if (await this.usesEnvelopeTable()) {
			await this.execute(`UPDATE message_queue SET status = ${toSqlValue(request.status)}, updated_at = ${toSqlValue(nowIso())} WHERE id = ${request.id}`);
			return;
		}
		await this.execute(`UPDATE messages SET status = ${toSqlValue(request.status)}, updated_at = ${toSqlValue(nowIso())} WHERE id = ${request.id}`);
	}

	async create(request: SdkCreateMessageRequest) {
		const timestamp = nowIso();
		if (await this.usesEnvelopeTable()) {
			const envelope = createMessageEnvelope({
				type: request.type,
				payload: request.payload,
				meta: { actor: request.actor },
			});
			await this.execute(
				`INSERT INTO message_queue (message_type, status, schema_version, related_model, related_id, priority, available_at, attempts, max_attempts, created_at, updated_at, payload_json, meta_json) VALUES (${toSqlValue(request.type)}, ${toSqlValue(envelope.status)}, ${TRESEED_ENVELOPE_SCHEMA_VERSION}, ${toSqlValue(request.relatedModel ?? null)}, ${toSqlValue(request.relatedId ?? null)}, ${request.priority ?? 0}, ${toSqlValue(timestamp)}, 0, ${request.maxAttempts ?? 3}, ${toSqlValue(timestamp)}, ${toSqlValue(timestamp)}, ${toSqlValue(JSON.stringify(envelope.payload))}, ${toSqlValue(JSON.stringify(envelope.meta))})`,
			);
			const row = await this.selectFirst('SELECT * FROM message_queue ORDER BY id DESC LIMIT 1');
			if (!row) {
				throw new Error('Failed to create message record.');
			}
			return messageEntityFromEnvelope(row);
		}
		await this.execute(
			`INSERT INTO messages (type, status, payload_json, related_model, related_id, priority, available_at, attempts, max_attempts, created_at, updated_at) VALUES (${toSqlValue(request.type)}, 'pending', ${toSqlValue(JSON.stringify(request.payload))}, ${toSqlValue(request.relatedModel ?? null)}, ${toSqlValue(request.relatedId ?? null)}, ${request.priority ?? 0}, ${toSqlValue(timestamp)}, 0, ${request.maxAttempts ?? 3}, ${toSqlValue(timestamp)}, ${toSqlValue(timestamp)})`,
		);
		const row = await this.selectFirst('SELECT * FROM messages ORDER BY id DESC LIMIT 1');
		if (!row) {
			throw new Error('Failed to create message record.');
		}
		return messageFromRow(row);
	}

	async update(request: SdkUpdateRequest) {
		const id = Number(request.id ?? request.key ?? request.data.id ?? 0);
		if (!id) {
			throw new Error('Message update requires an id.');
		}
		const existing = await this.getById(id);
		if (!existing) {
			return null;
		}
		assertExpectedVersion(request.expectedVersion, existing, `message ${id}`);
		if (await this.usesEnvelopeTable()) {
			const fields: string[] = [];
			for (const [key, value] of Object.entries(request.data)) {
				if (key === 'payload') {
					fields.push(`payload_json = ${toSqlValue(JSON.stringify({ body: value }))}`);
					continue;
				}
				if (key === 'meta') {
					fields.push(`meta_json = ${toSqlValue(JSON.stringify(value))}`);
					continue;
				}
				const column = messageEnvelopeColumn(key);
				fields.push(`${column} = ${toSqlValue(value)}`);
			}
			fields.push(`updated_at = ${toSqlValue(nowIso())}`);
			await this.execute(`UPDATE message_queue SET ${fields.join(', ')} WHERE id = ${id}`);
			return this.getById(id);
		}
		const fields: string[] = [];
		for (const [key, value] of Object.entries(request.data)) {
			if (key === 'payload') {
				fields.push(`payload_json = ${toSqlValue(JSON.stringify(value))}`);
				continue;
			}
			const column = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
			fields.push(`${column} = ${toSqlValue(value)}`);
		}
		fields.push(`updated_at = ${toSqlValue(nowIso())}`);
		await this.execute(`UPDATE messages SET ${fields.join(', ')} WHERE id = ${id}`);
		return this.getById(id);
	}
}

function buildEnvelopeFilterSql(filters: SdkSearchRequest['filters'] = []) {
	return filters?.length
		? `WHERE ${filters
			.map((filter) => {
				const field = messageFilterColumn(filter.field);
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

function buildEnvelopeOrderSql(sort: SdkSearchRequest['sort'] = []) {
	return sort?.length
		? `ORDER BY ${sort.map((entry) => `${messageSortColumn(entry.field)} ${entry.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`
		: '';
}

function messageFilterColumn(field: string) {
	switch (field) {
		case 'type':
			return 'message_type';
		case 'status':
		case 'priority':
		case 'available_at':
		case 'availableAt':
		case 'created_at':
		case 'createdAt':
		case 'updated_at':
		case 'updatedAt':
			return field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
		default:
			return `json_extract(payload_json, '$.body.${field}')`;
	}
}

function messageSortColumn(field: string) {
	switch (field) {
		case 'type':
			return 'message_type';
		case 'priority':
			return 'priority';
		case 'available_at':
		case 'availableAt':
			return 'available_at';
		case 'created_at':
		case 'createdAt':
			return 'created_at';
		case 'updated_at':
		case 'updatedAt':
		default:
			return 'updated_at';
	}
}

function messageEnvelopeColumn(field: string) {
	switch (field) {
		case 'type':
			return 'message_type';
		case 'relatedModel':
		case 'related_model':
			return 'related_model';
		case 'relatedId':
		case 'related_id':
			return 'related_id';
		case 'maxAttempts':
		case 'max_attempts':
			return 'max_attempts';
		case 'availableAt':
		case 'available_at':
			return 'available_at';
		case 'claimedBy':
		case 'claimed_by':
			return 'claimed_by';
		case 'claimedAt':
		case 'claimed_at':
			return 'claimed_at';
		case 'leaseExpiresAt':
		case 'lease_expires_at':
			return 'lease_expires_at';
		default:
			return field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
	}
}
