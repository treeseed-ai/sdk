import { randomUUID } from 'node:crypto';
import { NodeSqliteD1Database } from '../db/node-sqlite.ts';
import {
	type PlatformOperation,
	type PlatformOperationEvent,
	type PlatformRunnerClaimRequest,
	type PlatformRunnerHeartbeatRequest,
	type PlatformRunnerJobUpdateRequest,
	type PlatformRunnerRegistrationRequest,
} from '../platform-operations.ts';
import { PLATFORM_OPERATION_SCHEMA_SQL, PlatformOperationStoreOptions, RelationalDatabaseAdapter, isoNow, normalizeOperationCapabilities, parseJson, repositoryKey, repositoryWorkspacePath, rowEvent, rowOperation } from './database-provider.ts';

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
		const row = await this.database.first<{ next_seq?: number }>(
			`SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM platform_operation_events WHERE operation_id = ?`,
			[operationId],
		);
		const seq = Number(row?.next_seq ?? 1);
		const timestamp = isoNow(this.now);
		const id = randomUUID();
		await this.database.run(
			`INSERT INTO platform_operation_events (id, operation_id, seq, kind, data_json, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[id, operationId, seq, kind, JSON.stringify(data ?? {}), timestamp],
		);
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
				    OR (status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
				 )
				 ${capabilityWhere}
				 ORDER BY created_at ASC LIMIT 1`,
				[input.operationId, now, ...capabilityParams],
			)
			: await this.database.all(
				`SELECT * FROM platform_operations
				 WHERE (
				    status = 'queued'
				    OR (status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
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
		await this.appendPlatformOperationEvent(String(row.id), 'claimed', { runnerId, leaseExpiresAt });
		const operation = rowOperation(await this.database.first(`SELECT * FROM platform_operations WHERE id = ?`, [row.id]));
		if (operation?.input?.repository && typeof operation.input.repository === 'object' && !Array.isArray(operation.input.repository)) {
			const runner = await this.database.first<Record<string, unknown>>(`SELECT * FROM market_operation_runners WHERE id = ?`, [runnerId]);
			const metadata = parseJson(runner?.metadata_json, {}) as Record<string, unknown>;
			const workspaceRoot = metadata.dataDir ?? '/data';
			const repository = operation.input.repository as Record<string, unknown>;
			await this.upsertRepositoryClaim({
				runnerId,
				repository,
				workspaceRoot,
				branch: String(repository.defaultBranch ?? ''),
				leaseSeconds,
				metadata: { operationId: operation.id, namespace: operation.namespace, operation: operation.operation },
			});
		}
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
		await this.renewRepositoryClaimsForRunner(request.runnerId, leaseSeconds);
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
		const output = request.output && typeof request.output === 'object' ? request.output as Record<string, unknown> : {};
		await this.releaseRepositoryClaimsForRunner(request.runnerId, {
			branch: output.operationBranch ?? output.branch ?? null,
			commitSha: output.commitSha ?? null,
			metadata: { operationId, status: 'succeeded' },
		});
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
		await this.releaseRepositoryClaimsForRunner(request.runnerId, {
			claimState: 'released',
			metadata: { operationId, status: 'failed' },
		});
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
		await this.releaseRepositoryClaimsForRunner(request.runnerId, {
			claimState: 'released',
			metadata: { operationId, status: 'cancelled' },
		});
		return this.getOperation(operationId);
	}

	private async upsertRepositoryClaim(input: { runnerId: string; repository: Record<string, unknown>; workspaceRoot: unknown; branch?: string | null; leaseSeconds: number; metadata?: Record<string, unknown> }) {
		const repositoryKeyValue = repositoryKey(input.repository);
		const timestamp = isoNow(this.now);
		const leaseExpiresAt = new Date(this.now().getTime() + input.leaseSeconds * 1000).toISOString();
		const existing = await this.database.first<Record<string, unknown>>(
			`SELECT * FROM platform_repository_claims WHERE repository_key = ? AND runner_id = ? AND claim_state = 'active' LIMIT 1`,
			[repositoryKeyValue, input.runnerId],
		);
		if (existing) {
			await this.database.run(
				`UPDATE platform_repository_claims SET lease_expires_at = ?, metadata_json = ?, updated_at = ? WHERE id = ?`,
				[leaseExpiresAt, JSON.stringify(input.metadata ?? parseJson(existing.metadata_json, {})), timestamp, existing.id],
			);
			return;
		}
		await this.database.run(
			`INSERT INTO platform_repository_claims (
				id, repository_key, runner_id, workspace_path, branch, commit_sha, claim_state, lease_expires_at, metadata_json, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, NULL, 'active', ?, ?, ?, ?)`,
			[
				randomUUID(),
				repositoryKeyValue,
				input.runnerId,
				repositoryWorkspacePath(input.workspaceRoot, input.repository),
				input.branch ?? null,
				leaseExpiresAt,
				JSON.stringify(input.metadata ?? {}),
				timestamp,
				timestamp,
			],
		);
	}

	private async renewRepositoryClaimsForRunner(runnerId?: string | null, leaseSeconds = 300) {
		if (!runnerId) return;
		const timestamp = isoNow(this.now);
		const leaseExpiresAt = new Date(this.now().getTime() + leaseSeconds * 1000).toISOString();
		await this.database.run(
			`UPDATE platform_repository_claims SET lease_expires_at = ?, updated_at = ? WHERE runner_id = ? AND claim_state = 'active'`,
			[leaseExpiresAt, timestamp, runnerId],
		);
	}

	private async releaseRepositoryClaimsForRunner(runnerId?: string | null, input: { claimState?: string; branch?: unknown; commitSha?: unknown; metadata?: Record<string, unknown> } = {}) {
		if (!runnerId) return;
		const rows = await this.database.all<Record<string, unknown>>(
			`SELECT * FROM platform_repository_claims WHERE runner_id = ? AND claim_state = 'active'`,
			[runnerId],
		);
		const timestamp = isoNow(this.now);
		for (const row of rows) {
			await this.database.run(
				`UPDATE platform_repository_claims
				 SET claim_state = ?,
				     branch = COALESCE(?, branch),
				     commit_sha = COALESCE(?, commit_sha),
				     lease_expires_at = NULL,
				     metadata_json = ?,
				     updated_at = ?
				 WHERE id = ?`,
				[
					input.claimState ?? 'released',
					input.branch ?? null,
					input.commitSha ?? null,
					JSON.stringify({ ...(parseJson(row.metadata_json, {}) as Record<string, unknown>), ...(input.metadata ?? {}) }),
					timestamp,
					row.id,
				],
			);
		}
	}
}
