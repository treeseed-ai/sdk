import type {
	SdkMutationRequest,
	SdkSearchRequest,
	SdkSubscriptionEntity,
	SdkUpdateRequest,
} from '../sdk-types.ts';
import { assertExpectedVersion } from '../sdk-version.ts';
import { SqliteStoreBase, toSqlValue } from './helpers.ts';
import { createSubscriptionEnvelope, subscriptionEntityFromEnvelope, TRESEED_ENVELOPE_SCHEMA_VERSION } from './envelopes.ts';

function subscriptionFromRow(row: Record<string, unknown>): SdkSubscriptionEntity {
	return {
		id: row.id !== undefined ? Number(row.id) : undefined,
		email: String(row.email ?? ''),
		name: row.name !== undefined && row.name !== null ? String(row.name) : null,
		status: String(row.status ?? 'active'),
		source: row.source !== undefined && row.source !== null ? String(row.source) : undefined,
		consent_at: row.consent_at !== undefined && row.consent_at !== null ? String(row.consent_at) : undefined,
		created_at: row.created_at !== undefined && row.created_at !== null ? String(row.created_at) : undefined,
		updated_at: row.updated_at !== undefined && row.updated_at !== null ? String(row.updated_at) : undefined,
		ip_hash: row.ip_hash !== undefined && row.ip_hash !== null ? String(row.ip_hash) : undefined,
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

export class SubscriptionStore extends SqliteStoreBase {
	private async usesEnvelopeTable() {
		return this.tableExists('runtime_records');
	}

	async getByKey(key: string) {
		if (await this.usesEnvelopeTable()) {
			const row = await this.selectFirst(
				`SELECT * FROM runtime_records WHERE record_type = 'subscription' AND (record_key = ${toSqlValue(key)} OR lookup_key = ${toSqlValue(key)} OR id = ${toSqlValue(key)}) LIMIT 1`,
			);
			if (row) {
				return subscriptionEntityFromEnvelope(row);
			}
		}
		const field = key.includes('@') ? 'email' : 'id';
		const row = await this.selectFirst(`SELECT * FROM subscriptions WHERE ${field} = ${toSqlValue(key)} LIMIT 1`);
		return row ? subscriptionFromRow(row) : null;
	}

	async search(request: SdkSearchRequest) {
		if (await this.usesEnvelopeTable()) {
			const sql = [
				"SELECT * FROM runtime_records WHERE record_type = 'subscription'",
				buildEnvelopeFilterSql(request.filters),
				request.sort?.length
					? `ORDER BY ${request.sort.map((entry) => `${subscriptionSortColumn(entry.field)} ${entry.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`
					: 'ORDER BY updated_at DESC',
				request.limit ? `LIMIT ${request.limit}` : '',
			].filter(Boolean).join(' ');
			const rows = await this.selectAll(sql);
			return rows.map(subscriptionEntityFromEnvelope);
		}
		const sql = [
			'SELECT * FROM subscriptions',
			buildFilterSql(request.filters),
			request.sort?.length
				? `ORDER BY ${request.sort.map((entry) => `${entry.field} ${entry.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`
				: '',
			request.limit ? `LIMIT ${request.limit}` : '',
		].filter(Boolean).join(' ');
		const rows = await this.selectAll(sql);
		return rows.map(subscriptionFromRow);
	}

	async create(request: SdkMutationRequest) {
		const data = request.data;
		if (await this.usesEnvelopeTable()) {
			const envelope = createSubscriptionEnvelope({
				email: String(data.email ?? ''),
				name: data.name !== undefined && data.name !== null ? String(data.name) : null,
				status: typeof data.status === 'string' ? data.status : 'active',
				source: typeof data.source === 'string' ? data.source : 'sdk',
				consentAt: typeof data.consent_at === 'string' ? data.consent_at : new Date().toISOString(),
				ipHash: typeof data.ip_hash === 'string' ? data.ip_hash : '',
			});
			const now = new Date().toISOString();
			await this.execute(
				`INSERT INTO runtime_records (record_type, record_key, lookup_key, status, schema_version, created_at, updated_at, payload_json, meta_json) VALUES ('subscription', ${toSqlValue(envelope.payload.email)}, ${toSqlValue(envelope.payload.email)}, ${toSqlValue(envelope.status)}, ${TRESEED_ENVELOPE_SCHEMA_VERSION}, ${toSqlValue(now)}, ${toSqlValue(now)}, ${toSqlValue(JSON.stringify(envelope.payload))}, ${toSqlValue(JSON.stringify(envelope.meta))})`,
			);
			return this.getByKey(envelope.payload.email);
		}
		await this.execute(
			`INSERT INTO subscriptions (email, name, status, source, consent_at, created_at, updated_at, ip_hash) VALUES (${toSqlValue(data.email)}, ${toSqlValue(data.name ?? null)}, ${toSqlValue(data.status ?? 'active')}, ${toSqlValue(data.source ?? 'sdk')}, ${toSqlValue(data.consent_at ?? new Date().toISOString())}, ${toSqlValue(data.created_at ?? new Date().toISOString())}, ${toSqlValue(data.updated_at ?? new Date().toISOString())}, ${toSqlValue(data.ip_hash ?? '')})`,
		);
		return this.getByKey(String(data.email));
	}

	async update(request: SdkUpdateRequest) {
		const key = String(request.id ?? request.key ?? request.data.email ?? '');
		const existing = await this.getByKey(key);
		if (!existing) {
			throw new Error(`No subscription found for "${key}".`);
		}
		assertExpectedVersion(request.expectedVersion, existing, `subscription "${existing.email}"`);
		const next = {
			...existing,
			...request.data,
			updated_at: new Date().toISOString(),
		};
		if (await this.usesEnvelopeTable()) {
			const envelope = createSubscriptionEnvelope({
				email: existing.email,
				name: next.name ?? null,
				status: String(next.status ?? 'active'),
				source: typeof next.source === 'string' ? next.source : 'sdk',
				consentAt: typeof next.consent_at === 'string' ? next.consent_at : null,
				ipHash: typeof next.ip_hash === 'string' ? next.ip_hash : '',
				meta: { legacyId: existing.id },
			});
			await this.execute(
				`UPDATE runtime_records SET status = ${toSqlValue(envelope.status)}, updated_at = ${toSqlValue(String(next.updated_at))}, payload_json = ${toSqlValue(JSON.stringify(envelope.payload))}, meta_json = ${toSqlValue(JSON.stringify(envelope.meta))} WHERE record_type = 'subscription' AND record_key = ${toSqlValue(existing.email)}`,
			);
			return this.getByKey(existing.email);
		}
		await this.execute(
			`UPDATE subscriptions SET name = ${toSqlValue(next.name ?? null)}, status = ${toSqlValue(next.status)}, source = ${toSqlValue(next.source ?? 'sdk')}, consent_at = ${toSqlValue(next.consent_at ?? null)}, updated_at = ${toSqlValue(next.updated_at ?? new Date().toISOString())}, ip_hash = ${toSqlValue(next.ip_hash ?? '')} WHERE email = ${toSqlValue(existing.email)}`,
		);
		return this.getByKey(existing.email);
	}
}

function buildEnvelopeFilterSql(filters: SdkSearchRequest['filters'] = []) {
	if (!filters?.length) return '';
	const clauses = filters.map((filter) => {
		const field = subscriptionFilterColumn(filter.field);
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
	});
	return clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';
}

function subscriptionFilterColumn(field: string) {
	switch (field) {
		case 'email':
			return 'lookup_key';
		case 'status':
			return 'status';
		case 'updated_at':
		case 'updatedAt':
			return 'updated_at';
		case 'created_at':
		case 'createdAt':
			return 'created_at';
		default:
			return `json_extract(payload_json, '$.${field}')`;
	}
}

function subscriptionSortColumn(field: string) {
	switch (field) {
		case 'email':
			return 'lookup_key';
		case 'status':
			return 'status';
		case 'created_at':
		case 'createdAt':
			return 'created_at';
		case 'updated_at':
		case 'updatedAt':
		default:
			return 'updated_at';
	}
}
