import crypto from 'node:crypto';
import type { D1DatabaseLike } from '../../types/cloudflare.ts';
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
} from '../../projects/projects-core/project-workflow.ts';
import { SqliteStoreBase, nowIso, toSqlValue, type DatabaseRow } from '../helpers.ts';
import { JsonRecord, parseJson, releaseSummaryFromRow, sharePackageFromRow, stringify, workstreamEventFromRow, workstreamFromRow } from './json-record.ts';

export class SqliteProjectWorkflowStore extends SqliteStoreBase {
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
