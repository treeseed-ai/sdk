import crypto from 'node:crypto';
import type { D1DatabaseLike } from '../types/cloudflare.ts';
import type {
	ReleaseDetail,
	ReleaseState,
	ReleaseSummary,
	SharePackageState,
	SharePackageStatus,
	WorkstreamDetail,
	WorkstreamEvent,
	WorkstreamState,
	WorkstreamSummary,
	LinkedProjectRecordRef,
} from '../knowledge-coop.ts';
import { SqliteStoreBase, nowIso, toSqlValue, type DatabaseRow } from './helpers.ts';

type JsonRecord = Record<string, unknown>;

function parseJson<T>(value: unknown, fallback: T): T {
	if (typeof value !== 'string' || !value.trim()) {
		return fallback;
	}
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function stringify(value: unknown) {
	return JSON.stringify(value ?? {});
}

function linkedItemsFromRow(row: DatabaseRow): LinkedProjectRecordRef[] {
	return parseJson<LinkedProjectRecordRef[]>(row.linked_items_json, []);
}

function workstreamFromRow(row: DatabaseRow): WorkstreamSummary {
	return {
		id: String(row.id ?? ''),
		projectId: String(row.project_id ?? ''),
		title: String(row.title ?? ''),
		summary: row.summary === null || row.summary === undefined ? null : String(row.summary),
		state: String(row.state ?? 'drafting') as WorkstreamState,
		branchName: row.branch_name === null || row.branch_name === undefined ? null : String(row.branch_name),
		branchRef: row.branch_ref === null || row.branch_ref === undefined ? null : String(row.branch_ref),
		owner: row.owner === null || row.owner === undefined ? null : String(row.owner),
		linkedItems: linkedItemsFromRow(row),
		verificationStatus: row.verification_status === null || row.verification_status === undefined ? null : String(row.verification_status) as WorkstreamSummary['verificationStatus'],
		verificationSummary: row.verification_summary === null || row.verification_summary === undefined ? null : String(row.verification_summary),
		lastSaveAt: row.last_save_at === null || row.last_save_at === undefined ? null : String(row.last_save_at),
		lastStageAt: row.last_stage_at === null || row.last_stage_at === undefined ? null : String(row.last_stage_at),
		archivedAt: row.archived_at === null || row.archived_at === undefined ? null : String(row.archived_at),
		createdAt: String(row.created_at ?? nowIso()),
		updatedAt: String(row.updated_at ?? nowIso()),
		metadata: parseJson<JsonRecord>(row.metadata_json, {}),
	};
}

function workstreamEventFromRow(row: DatabaseRow): WorkstreamEvent {
	return {
		id: String(row.id ?? ''),
		workstreamId: String(row.workstream_id ?? ''),
		projectId: String(row.project_id ?? ''),
		kind: String(row.kind ?? ''),
		summary: row.summary === null || row.summary === undefined ? null : String(row.summary),
		data: parseJson<JsonRecord>(row.data_json, {}),
		createdAt: String(row.created_at ?? nowIso()),
	};
}

function releaseSummaryFromRow(row: DatabaseRow): ReleaseSummary {
	return {
		id: String(row.id ?? ''),
		projectId: String(row.project_id ?? ''),
		version: String(row.version ?? ''),
		title: row.title === null || row.title === undefined ? null : String(row.title),
		state: String(row.state ?? 'drafting') as ReleaseState,
		summary: row.summary === null || row.summary === undefined ? null : String(row.summary),
		workstreamIds: parseJson<string[]>(row.workstream_ids_json, []),
		releaseTag: row.release_tag === null || row.release_tag === undefined ? null : String(row.release_tag),
		commitSha: row.commit_sha === null || row.commit_sha === undefined ? null : String(row.commit_sha),
		publishedAt: row.published_at === null || row.published_at === undefined ? null : String(row.published_at),
		rolledBackAt: row.rolled_back_at === null || row.rolled_back_at === undefined ? null : String(row.rolled_back_at),
		createdAt: String(row.created_at ?? nowIso()),
		updatedAt: String(row.updated_at ?? nowIso()),
		metadata: parseJson<JsonRecord>(row.metadata_json, {}),
	};
}

function sharePackageFromRow(row: DatabaseRow): SharePackageStatus {
	return {
		id: String(row.id ?? ''),
		projectId: String(row.project_id ?? ''),
		kind: String(row.kind ?? 'export') as SharePackageStatus['kind'],
		state: String(row.state ?? 'draft') as SharePackageState,
		title: String(row.title ?? ''),
		summary: row.summary === null || row.summary === undefined ? null : String(row.summary),
		version: row.version === null || row.version === undefined ? null : String(row.version),
		outputPath: row.output_path === null || row.output_path === undefined ? null : String(row.output_path),
		artifactKey: row.artifact_key === null || row.artifact_key === undefined ? null : String(row.artifact_key),
		manifestKey: row.manifest_key === null || row.manifest_key === undefined ? null : String(row.manifest_key),
		publishedItemId: row.published_item_id === null || row.published_item_id === undefined ? null : String(row.published_item_id),
		lastError: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
		createdAt: String(row.created_at ?? nowIso()),
		updatedAt: String(row.updated_at ?? nowIso()),
		metadata: parseJson<JsonRecord>(row.metadata_json, {}),
	};
}

export class MemoryKnowledgeCoopStore {
	private readonly workstreams = new Map<string, WorkstreamSummary>();
	private readonly workstreamEvents = new Map<string, WorkstreamEvent[]>();
	private readonly releases = new Map<string, ReleaseSummary>();
	private readonly releaseItems = new Map<string, ReleaseDetail['items']>();
	private readonly packages = new Map<string, SharePackageStatus>();

	listWorkstreams(projectId: string) {
		return [...this.workstreams.values()]
			.filter((entry) => entry.projectId === projectId)
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	getWorkstream(workstreamId: string): WorkstreamDetail | null {
		const workstream = this.workstreams.get(workstreamId);
		if (!workstream) return null;
		return {
			...workstream,
			events: [...(this.workstreamEvents.get(workstreamId) ?? [])],
		};
	}

	upsertWorkstream(input: Partial<WorkstreamSummary> & Pick<WorkstreamSummary, 'projectId' | 'title'>) {
		const timestamp = nowIso();
		const id = input.id ?? crypto.randomUUID();
		const existing = this.workstreams.get(id);
		const next: WorkstreamSummary = {
			id,
			projectId: input.projectId,
			title: input.title,
			summary: input.summary ?? existing?.summary ?? null,
			state: input.state ?? existing?.state ?? 'drafting',
			branchName: input.branchName ?? existing?.branchName ?? null,
			branchRef: input.branchRef ?? existing?.branchRef ?? null,
			owner: input.owner ?? existing?.owner ?? null,
			linkedItems: input.linkedItems ?? existing?.linkedItems ?? [],
			verificationStatus: input.verificationStatus ?? existing?.verificationStatus ?? null,
			verificationSummary: input.verificationSummary ?? existing?.verificationSummary ?? null,
			lastSaveAt: input.lastSaveAt ?? existing?.lastSaveAt ?? null,
			lastStageAt: input.lastStageAt ?? existing?.lastStageAt ?? null,
			archivedAt: input.archivedAt ?? existing?.archivedAt ?? null,
			createdAt: existing?.createdAt ?? timestamp,
			updatedAt: timestamp,
			metadata: input.metadata ?? existing?.metadata ?? {},
		};
		this.workstreams.set(id, next);
		return next;
	}

	appendWorkstreamEvent(input: Pick<WorkstreamEvent, 'projectId' | 'workstreamId' | 'kind'> & Partial<WorkstreamEvent>) {
		const event: WorkstreamEvent = {
			id: input.id ?? crypto.randomUUID(),
			projectId: input.projectId,
			workstreamId: input.workstreamId,
			kind: input.kind,
			summary: input.summary ?? null,
			data: input.data ?? {},
			createdAt: input.createdAt ?? nowIso(),
		};
		const events = this.workstreamEvents.get(input.workstreamId) ?? [];
		events.push(event);
		this.workstreamEvents.set(input.workstreamId, events);
		return event;
	}

	listReleases(projectId: string) {
		return [...this.releases.values()]
			.filter((entry) => entry.projectId === projectId)
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	getRelease(releaseId: string): ReleaseDetail | null {
		const release = this.releases.get(releaseId);
		if (!release) return null;
		return {
			...release,
			items: [...(this.releaseItems.get(releaseId) ?? [])],
		};
	}

	upsertRelease(input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & { items?: ReleaseDetail['items'] }): ReleaseDetail | null {
		const timestamp = nowIso();
		const id = input.id ?? crypto.randomUUID();
		const existing = this.releases.get(id);
		const next: ReleaseSummary = {
			id,
			projectId: input.projectId,
			version: input.version,
			title: input.title ?? existing?.title ?? null,
			state: input.state ?? existing?.state ?? 'drafting',
			summary: input.summary ?? existing?.summary ?? null,
			workstreamIds: input.workstreamIds ?? existing?.workstreamIds ?? [],
			releaseTag: input.releaseTag ?? existing?.releaseTag ?? null,
			commitSha: input.commitSha ?? existing?.commitSha ?? null,
			publishedAt: input.publishedAt ?? existing?.publishedAt ?? null,
			rolledBackAt: input.rolledBackAt ?? existing?.rolledBackAt ?? null,
			createdAt: existing?.createdAt ?? timestamp,
			updatedAt: timestamp,
			metadata: input.metadata ?? existing?.metadata ?? {},
		};
		this.releases.set(id, next);
		if (input.items) {
			this.releaseItems.set(id, [...input.items]);
		}
		return this.getRelease(id);
	}

	listSharePackages(projectId: string) {
		return [...this.packages.values()]
			.filter((entry) => entry.projectId === projectId)
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	getSharePackage(packageId: string) {
		return this.packages.get(packageId) ?? null;
	}

	upsertSharePackage(input: Partial<SharePackageStatus> & Pick<SharePackageStatus, 'projectId' | 'kind' | 'title'>) {
		const timestamp = nowIso();
		const id = input.id ?? crypto.randomUUID();
		const existing = this.packages.get(id);
		const next: SharePackageStatus = {
			id,
			projectId: input.projectId,
			kind: input.kind,
			state: input.state ?? existing?.state ?? 'draft',
			title: input.title,
			summary: input.summary ?? existing?.summary ?? null,
			version: input.version ?? existing?.version ?? null,
			outputPath: input.outputPath ?? existing?.outputPath ?? null,
			artifactKey: input.artifactKey ?? existing?.artifactKey ?? null,
			manifestKey: input.manifestKey ?? existing?.manifestKey ?? null,
			publishedItemId: input.publishedItemId ?? existing?.publishedItemId ?? null,
			lastError: input.lastError ?? existing?.lastError ?? null,
			createdAt: existing?.createdAt ?? timestamp,
			updatedAt: timestamp,
			metadata: input.metadata ?? existing?.metadata ?? {},
		};
		this.packages.set(id, next);
		return next;
	}
}

export class SqliteKnowledgeCoopStore extends SqliteStoreBase {
	private initialized = false;

	private async ensureSchema() {
		if (this.initialized) return;
		const statements = [
			`CREATE TABLE IF NOT EXISTS project_workstreams (
				id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL,
				title TEXT NOT NULL,
				summary TEXT,
				state TEXT NOT NULL,
				branch_name TEXT,
				branch_ref TEXT,
				owner TEXT,
				linked_items_json TEXT NOT NULL DEFAULT '[]',
				verification_status TEXT,
				verification_summary TEXT,
				last_save_at TEXT,
				last_stage_at TEXT,
				archived_at TEXT,
				metadata_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS idx_project_workstreams_project_updated
				ON project_workstreams(project_id, updated_at DESC)`,
			`CREATE TABLE IF NOT EXISTS project_workstream_events (
				id TEXT PRIMARY KEY,
				workstream_id TEXT NOT NULL,
				project_id TEXT NOT NULL,
				kind TEXT NOT NULL,
				summary TEXT,
				data_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS idx_project_workstream_events_workstream_created
				ON project_workstream_events(workstream_id, created_at ASC)`,
			`CREATE TABLE IF NOT EXISTS project_releases (
				id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL,
				version TEXT NOT NULL,
				title TEXT,
				state TEXT NOT NULL,
				summary TEXT,
				workstream_ids_json TEXT NOT NULL DEFAULT '[]',
				release_tag TEXT,
				commit_sha TEXT,
				published_at TEXT,
				rolled_back_at TEXT,
				metadata_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS idx_project_releases_project_updated
				ON project_releases(project_id, updated_at DESC)`,
			`CREATE TABLE IF NOT EXISTS project_release_items (
				id TEXT PRIMARY KEY,
				release_id TEXT NOT NULL,
				workstream_id TEXT,
				model TEXT,
				record_id TEXT,
				summary TEXT,
				metadata_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS idx_project_release_items_release_created
				ON project_release_items(release_id, created_at ASC)`,
			`CREATE TABLE IF NOT EXISTS project_share_packages (
				id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL,
				kind TEXT NOT NULL,
				state TEXT NOT NULL,
				title TEXT NOT NULL,
				summary TEXT,
				version TEXT,
				output_path TEXT,
				artifact_key TEXT,
				manifest_key TEXT,
				published_item_id TEXT,
				last_error TEXT,
				metadata_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS idx_project_share_packages_project_updated
				ON project_share_packages(project_id, updated_at DESC)`,
		];
		for (const statement of statements) {
			await this.execute(statement);
		}
		this.initialized = true;
	}

	async listWorkstreams(projectId: string) {
		await this.ensureSchema();
		const rows = await this.selectAll(
			`SELECT * FROM project_workstreams WHERE project_id = ${toSqlValue(projectId)} ORDER BY updated_at DESC`,
		);
		return rows.map(workstreamFromRow);
	}

	async getWorkstream(workstreamId: string): Promise<WorkstreamDetail | null> {
		await this.ensureSchema();
		const row = await this.selectFirst(`SELECT * FROM project_workstreams WHERE id = ${toSqlValue(workstreamId)} LIMIT 1`);
		if (!row) return null;
		const eventRows = await this.selectAll(`SELECT * FROM project_workstream_events WHERE workstream_id = ${toSqlValue(workstreamId)} ORDER BY created_at ASC`);
		return {
			...workstreamFromRow(row),
			events: eventRows.map(workstreamEventFromRow),
		};
	}

	async upsertWorkstream(input: Partial<WorkstreamSummary> & Pick<WorkstreamSummary, 'projectId' | 'title'>) {
		await this.ensureSchema();
		const id = input.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT OR REPLACE INTO project_workstreams (
				id, project_id, title, summary, state, branch_name, branch_ref, owner, linked_items_json, verification_status, verification_summary,
				last_save_at, last_stage_at, archived_at, metadata_json, created_at, updated_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(input.projectId)},
				${toSqlValue(input.title)},
				${toSqlValue(input.summary ?? null)},
				${toSqlValue(input.state ?? 'drafting')},
				${toSqlValue(input.branchName ?? null)},
				${toSqlValue(input.branchRef ?? null)},
				${toSqlValue(input.owner ?? null)},
				${toSqlValue(JSON.stringify(input.linkedItems ?? []))},
				${toSqlValue(input.verificationStatus ?? null)},
				${toSqlValue(input.verificationSummary ?? null)},
				${toSqlValue(input.lastSaveAt ?? null)},
				${toSqlValue(input.lastStageAt ?? null)},
				${toSqlValue(input.archivedAt ?? null)},
				${toSqlValue(stringify(input.metadata ?? {}))},
				COALESCE((SELECT created_at FROM project_workstreams WHERE id = ${toSqlValue(id)}), ${toSqlValue(timestamp)}),
				${toSqlValue(timestamp)}
			)`,
		);
		const detail = await this.getWorkstream(id);
		return detail ? { ...detail } : null;
	}

	async appendWorkstreamEvent(input: Pick<WorkstreamEvent, 'projectId' | 'workstreamId' | 'kind'> & Partial<WorkstreamEvent>) {
		await this.ensureSchema();
		const id = input.id ?? crypto.randomUUID();
		await this.execute(
			`INSERT INTO project_workstream_events (
				id, workstream_id, project_id, kind, summary, data_json, created_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(input.workstreamId)},
				${toSqlValue(input.projectId)},
				${toSqlValue(input.kind)},
				${toSqlValue(input.summary ?? null)},
				${toSqlValue(stringify(input.data ?? {}))},
				${toSqlValue(input.createdAt ?? nowIso())}
			)`,
		);
		const row = await this.selectFirst(`SELECT * FROM project_workstream_events WHERE id = ${toSqlValue(id)} LIMIT 1`);
		return row ? workstreamEventFromRow(row) : null;
	}

	async listReleases(projectId: string) {
		await this.ensureSchema();
		const rows = await this.selectAll(`SELECT * FROM project_releases WHERE project_id = ${toSqlValue(projectId)} ORDER BY updated_at DESC`);
		return rows.map(releaseSummaryFromRow);
	}

	async getRelease(releaseId: string): Promise<ReleaseDetail | null> {
		await this.ensureSchema();
		const row = await this.selectFirst(`SELECT * FROM project_releases WHERE id = ${toSqlValue(releaseId)} LIMIT 1`);
		if (!row) return null;
		const items = await this.selectAll(`SELECT * FROM project_release_items WHERE release_id = ${toSqlValue(releaseId)} ORDER BY created_at ASC`);
		return {
			...releaseSummaryFromRow(row),
			items: items.map((item) => ({
				id: String(item.id ?? ''),
				workstreamId: item.workstream_id === null || item.workstream_id === undefined ? null : String(item.workstream_id),
				model: item.model === null || item.model === undefined ? null : String(item.model),
				recordId: item.record_id === null || item.record_id === undefined ? null : String(item.record_id),
				summary: item.summary === null || item.summary === undefined ? null : String(item.summary),
				metadata: parseJson<JsonRecord>(item.metadata_json, {}),
				createdAt: String(item.created_at ?? nowIso()),
			})),
		};
	}

	async upsertRelease(input: Partial<ReleaseSummary> & Pick<ReleaseSummary, 'projectId' | 'version'> & { items?: ReleaseDetail['items'] }) {
		await this.ensureSchema();
		const id = input.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT OR REPLACE INTO project_releases (
				id, project_id, version, title, state, summary, workstream_ids_json, release_tag, commit_sha, published_at, rolled_back_at, metadata_json, created_at, updated_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(input.projectId)},
				${toSqlValue(input.version)},
				${toSqlValue(input.title ?? null)},
				${toSqlValue(input.state ?? 'drafting')},
				${toSqlValue(input.summary ?? null)},
				${toSqlValue(JSON.stringify(input.workstreamIds ?? []))},
				${toSqlValue(input.releaseTag ?? null)},
				${toSqlValue(input.commitSha ?? null)},
				${toSqlValue(input.publishedAt ?? null)},
				${toSqlValue(input.rolledBackAt ?? null)},
				${toSqlValue(stringify(input.metadata ?? {}))},
				COALESCE((SELECT created_at FROM project_releases WHERE id = ${toSqlValue(id)}), ${toSqlValue(timestamp)}),
				${toSqlValue(timestamp)}
			)`,
		);
		if (input.items) {
			await this.execute(`DELETE FROM project_release_items WHERE release_id = ${toSqlValue(id)}`);
			for (const item of input.items) {
				await this.execute(
					`INSERT INTO project_release_items (
						id, release_id, workstream_id, model, record_id, summary, metadata_json, created_at
					) VALUES (
						${toSqlValue(item.id ?? crypto.randomUUID())},
						${toSqlValue(id)},
						${toSqlValue(item.workstreamId ?? null)},
						${toSqlValue(item.model ?? null)},
						${toSqlValue(item.recordId ?? null)},
						${toSqlValue(item.summary ?? null)},
						${toSqlValue(stringify(item.metadata ?? {}))},
						${toSqlValue(item.createdAt ?? timestamp)}
					)`,
				);
			}
		}
		return this.getRelease(id);
	}

	async listSharePackages(projectId: string) {
		await this.ensureSchema();
		const rows = await this.selectAll(`SELECT * FROM project_share_packages WHERE project_id = ${toSqlValue(projectId)} ORDER BY updated_at DESC`);
		return rows.map(sharePackageFromRow);
	}

	async getSharePackage(packageId: string) {
		await this.ensureSchema();
		const row = await this.selectFirst(`SELECT * FROM project_share_packages WHERE id = ${toSqlValue(packageId)} LIMIT 1`);
		return row ? sharePackageFromRow(row) : null;
	}

	async upsertSharePackage(input: Partial<SharePackageStatus> & Pick<SharePackageStatus, 'projectId' | 'kind' | 'title'>) {
		await this.ensureSchema();
		const id = input.id ?? crypto.randomUUID();
		const timestamp = nowIso();
		await this.execute(
			`INSERT OR REPLACE INTO project_share_packages (
				id, project_id, kind, state, title, summary, version, output_path, artifact_key, manifest_key, published_item_id, last_error, metadata_json, created_at, updated_at
			) VALUES (
				${toSqlValue(id)},
				${toSqlValue(input.projectId)},
				${toSqlValue(input.kind)},
				${toSqlValue(input.state ?? 'draft')},
				${toSqlValue(input.title)},
				${toSqlValue(input.summary ?? null)},
				${toSqlValue(input.version ?? null)},
				${toSqlValue(input.outputPath ?? null)},
				${toSqlValue(input.artifactKey ?? null)},
				${toSqlValue(input.manifestKey ?? null)},
				${toSqlValue(input.publishedItemId ?? null)},
				${toSqlValue(input.lastError ?? null)},
				${toSqlValue(stringify(input.metadata ?? {}))},
				COALESCE((SELECT created_at FROM project_share_packages WHERE id = ${toSqlValue(id)}), ${toSqlValue(timestamp)}),
				${toSqlValue(timestamp)}
			)`,
		);
		return this.getSharePackage(id);
	}
}
