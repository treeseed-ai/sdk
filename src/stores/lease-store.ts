import crypto from 'node:crypto';
import type {
	SdkLeaseEntity,
	SdkLeaseReleaseRequest,
	SdkSearchRequest,
	SdkUpdateRequest,
} from '../sdk-types.ts';
import { assertExpectedVersion } from '../sdk-version.ts';
import { SqliteStoreBase, nowIso, toSqlValue } from './helpers.ts';
import { createLeaseEnvelope, leaseEntityFromEnvelope, TRESEED_ENVELOPE_SCHEMA_VERSION } from './envelopes.ts';

export interface LeaseClaimInput {
	model: string;
	itemKey: string;
	claimedBy: string;
	leaseSeconds: number;
}

function leaseFromRow(row: Record<string, unknown>): SdkLeaseEntity {
	return {
		model: String(row.model ?? ''),
		itemKey: String(row.itemKey ?? row.item_key ?? ''),
		claimedBy: String(row.claimedBy ?? row.claimed_by ?? ''),
		claimedAt: String(row.claimedAt ?? row.claimed_at ?? ''),
		leaseExpiresAt: String(row.leaseExpiresAt ?? row.lease_expires_at ?? ''),
		token: String(row.token ?? ''),
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
						return `lease_expires_at >= ${toSqlValue(filter.value)}`;
					default:
						return `${filter.field} LIKE ${toSqlValue(`%${String(filter.value ?? '')}%`)}`;
				}
			})
			.join(' AND ')}`
		: '';
}

export class LeaseStore extends SqliteStoreBase {
	private async usesEnvelopeTable() {
		return this.tableExists('lease_state');
	}

	async getByKey(key: string) {
		const [model, itemKey] = key.split(':', 2);
		if (!model || !itemKey) {
			return null;
		}
		if (await this.usesEnvelopeTable()) {
			const row = await this.selectFirst(
				`SELECT * FROM lease_state WHERE model = ${toSqlValue(model)} AND item_key = ${toSqlValue(itemKey)} LIMIT 1`,
			);
			return row ? leaseEntityFromEnvelope(row) : null;
		}
		const row = await this.selectFirst(
			`SELECT * FROM content_leases WHERE model = ${toSqlValue(model)} AND item_key = ${toSqlValue(itemKey)} LIMIT 1`,
		);
		return row ? leaseFromRow(row) : null;
	}

	async search(request: SdkSearchRequest) {
		if (await this.usesEnvelopeTable()) {
			const sql = [
				'SELECT * FROM lease_state',
				buildEnvelopeFilterSql(request.filters),
				request.sort?.length
					? `ORDER BY ${request.sort.map((entry) => `${leaseSortColumn(entry.field)} ${entry.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`
					: '',
				request.limit ? `LIMIT ${request.limit}` : '',
			].filter(Boolean).join(' ');
			const rows = await this.selectAll(sql);
			return rows.map(leaseEntityFromEnvelope);
		}
		const sql = [
			'SELECT * FROM content_leases',
			buildFilterSql(request.filters),
			request.sort?.length
				? `ORDER BY ${request.sort.map((entry) => `${entry.field} ${entry.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`
				: '',
			request.limit ? `LIMIT ${request.limit}` : '',
		].filter(Boolean).join(' ');
		const rows = await this.selectAll(sql);
		return rows.map(leaseFromRow);
	}

	async tryClaim(input: LeaseClaimInput) {
		if (await this.usesEnvelopeTable()) {
			const existing = await this.selectFirst(
				`SELECT * FROM lease_state WHERE model = ${toSqlValue(input.model)} AND item_key = ${toSqlValue(input.itemKey)} LIMIT 1`,
			);
			if (existing && new Date(String(existing.lease_expires_at ?? 0)).valueOf() > Date.now()) {
				return null;
			}
			const token = crypto.randomUUID();
			const claimedAt = nowIso();
			const leaseExpiresAt = new Date(Date.now() + input.leaseSeconds * 1000).toISOString();
			const envelope = createLeaseEnvelope({
				token,
				meta: { actor: input.claimedBy },
			});
			await this.execute(
				`INSERT OR REPLACE INTO lease_state (model, item_key, status, schema_version, claimed_by, claimed_at, lease_expires_at, created_at, updated_at, payload_json, meta_json) VALUES (${toSqlValue(input.model)}, ${toSqlValue(input.itemKey)}, ${toSqlValue(envelope.status)}, ${TRESEED_ENVELOPE_SCHEMA_VERSION}, ${toSqlValue(input.claimedBy)}, ${toSqlValue(claimedAt)}, ${toSqlValue(leaseExpiresAt)}, COALESCE((SELECT created_at FROM lease_state WHERE model = ${toSqlValue(input.model)} AND item_key = ${toSqlValue(input.itemKey)}), ${toSqlValue(claimedAt)}), ${toSqlValue(claimedAt)}, ${toSqlValue(JSON.stringify(envelope.payload))}, ${toSqlValue(JSON.stringify(envelope.meta))})`,
			);
			return token;
		}
		const existing = await this.selectFirst(
			`SELECT * FROM content_leases WHERE model = ${toSqlValue(input.model)} AND item_key = ${toSqlValue(input.itemKey)} LIMIT 1`,
		);
		if (existing && new Date(String(existing.lease_expires_at ?? 0)).valueOf() > Date.now()) {
			return null;
		}
		const token = crypto.randomUUID();
		await this.execute(
			`INSERT OR REPLACE INTO content_leases (model, item_key, claimed_by, claimed_at, lease_expires_at, token) VALUES (${toSqlValue(input.model)}, ${toSqlValue(input.itemKey)}, ${toSqlValue(input.claimedBy)}, ${toSqlValue(nowIso())}, ${toSqlValue(new Date(Date.now() + input.leaseSeconds * 1000).toISOString())}, ${toSqlValue(token)})`,
		);
		return token;
	}

	async create(input: LeaseClaimInput) {
		const token = await this.tryClaim(input);
		if (!token) {
			return this.getByKey(`${input.model}:${input.itemKey}`);
		}
		return this.getByKey(`${input.model}:${input.itemKey}`);
	}

	async release(request: SdkLeaseReleaseRequest) {
		if (await this.usesEnvelopeTable()) {
			await this.execute(
				`DELETE FROM lease_state WHERE model = ${toSqlValue(request.model)} AND item_key = ${toSqlValue(request.itemKey)}`,
			);
			return;
		}
		await this.execute(
			`DELETE FROM content_leases WHERE model = ${toSqlValue(request.model)} AND item_key = ${toSqlValue(request.itemKey)}`,
		);
	}

	async update(request: SdkUpdateRequest) {
		const model = String(request.data.model ?? request.id ?? '');
		const itemKey = String(request.data.item_key ?? request.data.itemKey ?? request.slug ?? request.key ?? '');
		const claimedBy = String(request.data.claimed_by ?? request.data.claimedBy ?? request.actor);
		const leaseSeconds = Number(request.data.leaseSeconds ?? 300);
		assertExpectedVersion(
			request.expectedVersion,
			await this.getByKey(`${model}:${itemKey}`),
			`content_lease "${model}:${itemKey}"`,
		);
		return this.create({ model, itemKey, claimedBy, leaseSeconds });
	}

	async releaseAll() {
		if (await this.usesEnvelopeTable()) {
			const rows = await this.selectAll('SELECT COUNT(*) AS count FROM lease_state');
			await this.execute('DELETE FROM lease_state');
			return Number(rows[0]?.count ?? 0);
		}
		const rows = await this.selectAll('SELECT COUNT(*) AS count FROM content_leases');
		await this.execute('DELETE FROM content_leases');
		return Number(rows[0]?.count ?? 0);
	}
}

function buildEnvelopeFilterSql(filters: SdkSearchRequest['filters'] = []) {
	return filters?.length
		? `WHERE ${filters
			.map((filter) => {
				const field = leaseFilterColumn(filter.field);
				switch (filter.op) {
					case 'eq':
						return `${field} = ${toSqlValue(filter.value)}`;
					case 'in':
						return `${field} IN (${(Array.isArray(filter.value) ? filter.value : [filter.value]).map(toSqlValue).join(', ')})`;
					case 'updated_since':
						return `lease_expires_at >= ${toSqlValue(filter.value)}`;
					default:
						return `${field} LIKE ${toSqlValue(`%${String(filter.value ?? '')}%`)}`;
				}
			})
			.join(' AND ')}`
		: '';
}

function leaseFilterColumn(field: string) {
	switch (field) {
		case 'model':
			return 'model';
		case 'itemKey':
		case 'item_key':
			return 'item_key';
		case 'claimedBy':
		case 'claimed_by':
			return 'claimed_by';
		case 'leaseExpiresAt':
		case 'lease_expires_at':
			return 'lease_expires_at';
		default:
			return `json_extract(payload_json, '$.${field}')`;
	}
}

function leaseSortColumn(field: string) {
	switch (field) {
		case 'model':
			return 'model';
		case 'itemKey':
		case 'item_key':
			return 'item_key';
		case 'leaseExpiresAt':
		case 'lease_expires_at':
		default:
			return 'lease_expires_at';
	}
}
