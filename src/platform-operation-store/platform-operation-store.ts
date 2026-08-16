import { randomUUID } from 'node:crypto';
import {
type PlatformRunnerClaimRequest,
type PlatformRunnerHeartbeatRequest,
type PlatformRunnerJobUpdateRequest,
type PlatformRunnerRegistrationRequest
} from '../operations/platform-operations.ts';
import { PLATFORM_OPERATION_SCHEMA_SQL,PlatformOperationStoreOptions,RelationalDatabaseAdapter,isoNow,normalizeOperationCapabilities,rowEvent,rowOperation } from './database-provider.ts';

export class PlatformOperationStore {
	private initialized = false;
	private readonly database: RelationalDatabaseAdapter;
	private readonly now: () => Date;
	private readonly initializeSchema: boolean;

	constructor(options: PlatformOperationStoreOptions) {
		this.database = options.database;
		this.now = options.now ?? (() => new Date());
		this.initializeSchema = options.initializeSchema ?? true;
	}

	async close() {
		await this.database.close?.();
	}

	async ensureInitialized() {
		if (this.initialized) return;
		if (this.initializeSchema) {
			if (this.database.exec) await this.database.exec(PLATFORM_OPERATION_SCHEMA_SQL);
			else {
				for (const statement of PLATFORM_OPERATION_SCHEMA_SQL.split(/;\s*/u).map((entry) => entry.trim()).filter(Boolean)) {
					await this.database.run(statement);
				}
			}
		}
		this.initialized = true;
	}

	private async appendPlatformOperationEvent(operationId: string, kind: string, data: Record<string, unknown> = {}) {
		await this.ensureInitialized();
		const timestamp = isoNow(this.now);
		const id = randomUUID();
		for (let attempt = 0; ; attempt += 1) {
			const row = await this.database.first<{ next_seq?: number }>(
				`SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM platform_operation_events WHERE operation_id = ?`,
				[operationId],
			);
			try {
				await this.database.run(
					`INSERT INTO platform_operation_events (id, operation_id, seq, kind, data_json, created_at)
					 VALUES (?, ?, ?, ?, ?, ?)`,
					[id, operationId, Number(row?.next_seq ?? 1), kind, JSON.stringify(data ?? {}), timestamp],
				);
				break;
			} catch (error) {
				const conflict = String((error as { code?: unknown }).code ?? '') === '23505'
					|| /idx_platform_operation_events_seq|operation_id.*seq/iu.test(error instanceof Error ? error.message : String(error));
				if (!conflict || attempt >= 63) throw error;
				await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(attempt + 1, 8)));
			}
		}
		return rowEvent(await this.database.first(`SELECT * FROM platform_operation_events WHERE id = ?`, [id]))!;
	}

	async register(request: PlatformRunnerRegistrationRequest) {
		return { ok: true as const, runner: await this.upsertRunner(request) };
	}

	async heartbeat(request: PlatformRunnerHeartbeatRequest) {
		return { ok: true as const, runner: await this.upsertRunner(request) };
	}

	private async upsertRunner(input: PlatformRunnerRegistrationRequest | PlatformRunnerHeartbeatRequest) {
		await this.ensureInitialized();
		const timestamp = isoNow(this.now);
		const id = input.runnerId;
		await this.database.run(
			`INSERT INTO market_operation_runners (
				id, runner_key, name, environment, status, version, capabilities_json,
				active_job_count, max_concurrent_jobs, heartbeat_at, metadata_json, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				runner_key = excluded.runner_key,
				name = excluded.name,
				environment = excluded.environment,
				status = excluded.status,
				version = excluded.version,
				capabilities_json = excluded.capabilities_json,
				active_job_count = excluded.active_job_count,
				max_concurrent_jobs = excluded.max_concurrent_jobs,
				heartbeat_at = excluded.heartbeat_at,
				metadata_json = excluded.metadata_json,
				updated_at = excluded.updated_at`,
			[
				id,
				('runnerKey' in input ? input.runnerKey : undefined) ?? id,
				('name' in input ? input.name : undefined) ?? id,
				input.environment ?? 'unknown',
				('status' in input ? input.status : undefined) ?? 'online',
				input.version ?? null,
				JSON.stringify(Array.isArray(input.capabilities) ? input.capabilities : []),
				Math.max(0, Number(('activeJobCount' in input ? input.activeJobCount : undefined) ?? 0) || 0),
				Math.max(1, Number(input.maxConcurrentJobs ?? 1) || 1),
				timestamp,
				JSON.stringify(input.metadata ?? {}),
				timestamp,
				timestamp,
			],
		);
		return this.database.first(`SELECT * FROM market_operation_runners WHERE id = ?`, [id]);
	}

	async getOperation(operationId: string) {
		await this.ensureInitialized();
		const operation = rowOperation(await this.database.first(`SELECT * FROM platform_operations WHERE id = ?`, [operationId]));
		if (!operation) throw new Error(`Unknown platform operation "${operationId}".`);
		return { ok: true as const, operation };
	}

	async claimJob(input: PlatformRunnerClaimRequest) {
		await this.ensureInitialized();
		const runnerId = input.runnerId;
		const leaseSeconds = Math.max(30, Math.min(Number(input.leaseSeconds ?? 300), 3600));
		const now = isoNow(this.now);
		const leaseExpiresAt = new Date(this.now().getTime() + leaseSeconds * 1000).toISOString();
		const capabilities = normalizeOperationCapabilities(input.capabilities);
		const capabilityWhere = capabilities.length > 0
			? ` AND (${capabilities.map(() => `(namespace || ':' || operation) = ?`).join(' OR ')})`
			: '';
		const capabilityParams = capabilities;
		const rows = input.operationId
			? await this.database.all(
				`SELECT * FROM platform_operations
				 WHERE id = ? AND (
				    status = 'queued'
				    OR (status IN ('leased', 'running') AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
				 )
				 ${capabilityWhere}
				 ORDER BY created_at ASC LIMIT 1`,
				[input.operationId, now, ...capabilityParams],
			)
			: await this.database.all(
				`SELECT * FROM platform_operations
				 WHERE (
				    status = 'queued'
				    OR (status IN ('leased', 'running') AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
				 )
				 ${capabilityWhere}
				 ORDER BY created_at ASC LIMIT 1`,
				[now, ...capabilityParams],
			);
		const row = rows[0];
		if (!row) return { ok: true as const, operation: null };
		await this.database.run(
			`UPDATE platform_operations
			 SET status = 'leased',
			     assigned_runner_id = ?,
			     lease_expires_at = ?,
			     started_at = COALESCE(started_at, ?),
			     updated_at = ?
			 WHERE id = ?`,
			[runnerId, leaseExpiresAt, now, now, row.id],
		);
		const reclaimed = ['leased', 'running'].includes(String(row.status));
		await this.appendPlatformOperationEvent(String(row.id), reclaimed ? 'runner.lease_reclaimed' : 'claimed', {
			runnerId,
			leaseExpiresAt,
			...(reclaimed ? { previousRunnerId: row.assigned_runner_id ?? null, previousStatus: row.status } : {}),
		});
		const operation = rowOperation(await this.database.first(`SELECT * FROM platform_operations WHERE id = ?`, [row.id]));
		return { ok: true as const, operation };
	}

	private async assertRunnerUpdate(operationId: string, runnerId?: string | null) {
		const operation = (await this.getOperation(operationId)).operation;
		if (!runnerId) throw new Error('runnerId is required.');
		if (operation.assignedRunnerId !== runnerId) throw new Error('Platform operation is assigned to a different runner.');
		if (['succeeded', 'failed', 'cancelled'].includes(operation.status)) throw new Error(`Platform operation is already ${operation.status}.`);
		return operation;
	}

	async appendEvent(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		await this.assertRunnerUpdate(operationId, request.runnerId);
		return { ok: true as const, event: await this.appendPlatformOperationEvent(operationId, request.event?.kind ?? 'event', request.event?.data ?? {}) };
	}

	async renewLease(operationId: string, request: PlatformRunnerJobUpdateRequest & { leaseSeconds?: number }) {
		await this.assertRunnerUpdate(operationId, request.runnerId);
		const leaseSeconds = Math.max(30, Math.min(Number(request.leaseSeconds ?? 300), 3600));
		const timestamp = isoNow(this.now);
		const leaseExpiresAt = new Date(this.now().getTime() + leaseSeconds * 1000).toISOString();
		await this.database.run(
			`UPDATE platform_operations SET lease_expires_at = ?, updated_at = ? WHERE id = ?`,
			[leaseExpiresAt, timestamp, operationId],
		);
		await this.appendPlatformOperationEvent(operationId, request.event?.kind ?? 'runner.lease_renewed', request.event?.data ?? { runnerId: request.runnerId, leaseExpiresAt });
		return this.getOperation(operationId);
	}

	async checkpoint(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		await this.assertRunnerUpdate(operationId, request.runnerId);
		const timestamp = isoNow(this.now);
		await this.database.run(
			`UPDATE platform_operations SET status = 'running', output_json = ?, updated_at = ? WHERE id = ?`,
			[JSON.stringify(request.output ?? null), timestamp, operationId],
		);
		await this.appendPlatformOperationEvent(operationId, request.event?.kind ?? 'checkpoint', request.event?.data ?? { runnerId: request.runnerId ?? null });
		return this.getOperation(operationId);
	}

	async complete(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		await this.assertRunnerUpdate(operationId, request.runnerId);
		const timestamp = isoNow(this.now);
		await this.database.run(
			`UPDATE platform_operations
			 SET status = 'succeeded', output_json = ?, error_json = NULL, lease_expires_at = NULL, updated_at = ?, finished_at = ?
			 WHERE id = ?`,
			[JSON.stringify(request.output ?? null), timestamp, timestamp, operationId],
		);
		await this.appendPlatformOperationEvent(operationId, request.event?.kind ?? 'completed', request.event?.data ?? {});
		return this.getOperation(operationId);
	}

	async fail(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		await this.assertRunnerUpdate(operationId, request.runnerId);
		const timestamp = isoNow(this.now);
		await this.database.run(
			`UPDATE platform_operations
			 SET status = 'failed', error_json = ?, lease_expires_at = NULL, updated_at = ?, finished_at = ?
			 WHERE id = ?`,
			[JSON.stringify(request.error ?? { message: 'Platform operation failed.' }), timestamp, timestamp, operationId],
		);
		await this.appendPlatformOperationEvent(operationId, request.event?.kind ?? 'failed', request.event?.data ?? {});
		return this.getOperation(operationId);
	}

	async cancel(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		await this.assertRunnerUpdate(operationId, request.runnerId);
		const timestamp = isoNow(this.now);
		await this.database.run(
			`UPDATE platform_operations
			 SET status = 'cancelled', error_json = ?, lease_expires_at = NULL, cancelled_at = COALESCE(cancelled_at, ?), updated_at = ?, finished_at = COALESCE(finished_at, ?)
			 WHERE id = ?`,
			[JSON.stringify(request.error ?? { message: 'Platform operation was cancelled.' }), timestamp, timestamp, timestamp, operationId],
		);
		await this.appendPlatformOperationEvent(operationId, request.event?.kind ?? 'runner.cancelled', request.event?.data ?? {});
		return this.getOperation(operationId);
	}
}
