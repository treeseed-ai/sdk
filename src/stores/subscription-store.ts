import type {
	SdkMutationRequest,
	SdkSearchRequest,
	SdkSubscriptionEntity,
	SdkUpdateRequest,
} from '../sdk-types.ts';
import { assertExpectedVersion } from '../sdk-version.ts';
import { SqliteStoreBase, toSqlValue } from './helpers.ts';

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
	async getByKey(key: string) {
		const field = key.includes('@') ? 'email' : 'id';
		const row = await this.selectFirst(`SELECT * FROM subscriptions WHERE ${field} = ${toSqlValue(key)} LIMIT 1`);
		return row ? subscriptionFromRow(row) : null;
	}

	async search(request: SdkSearchRequest) {
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
		await this.execute(
			`INSERT INTO subscriptions (email, name, status, source, consent_at, created_at, updated_at, ip_hash) VALUES (${toSqlValue(data.email)}, ${toSqlValue(data.name ?? null)}, ${toSqlValue(data.status ?? 'active')}, ${toSqlValue(data.source ?? 'sdk')}, ${toSqlValue(data.consent_at ?? data.consentAt ?? new Date().toISOString())}, ${toSqlValue(data.created_at ?? data.createdAt ?? new Date().toISOString())}, ${toSqlValue(data.updated_at ?? data.updatedAt ?? new Date().toISOString())}, ${toSqlValue(data.ip_hash ?? data.ipHash ?? '')})`,
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
		await this.execute(
			`UPDATE subscriptions SET name = ${toSqlValue(next.name ?? null)}, status = ${toSqlValue(next.status)}, source = ${toSqlValue(next.source ?? 'sdk')}, consent_at = ${toSqlValue(next.consent_at ?? null)}, updated_at = ${toSqlValue(next.updated_at ?? new Date().toISOString())}, ip_hash = ${toSqlValue(next.ip_hash ?? '')} WHERE email = ${toSqlValue(existing.email)}`,
		);
		return this.getByKey(existing.email);
	}
}
