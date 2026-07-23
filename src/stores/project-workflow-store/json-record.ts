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
} from '../../project-workflow.ts';
import { SqliteStoreBase, nowIso, toSqlValue, type DatabaseRow } from '../helpers.ts';


export type JsonRecord = Record<string, unknown>;

export function parseJson<T>(value: unknown, fallback: T): T {
	if (typeof value !== 'string' || !value.trim()) {
		return fallback;
	}
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export function stringify(value: unknown) {
	return JSON.stringify(value ?? {});
}

export function linkedItemsFromRow(row: DatabaseRow): LinkedProjectRecordRef[] {
	return parseJson<LinkedProjectRecordRef[]>(row.linked_items_json, []);
}

export function workstreamFromRow(row: DatabaseRow): WorkstreamSummary {
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

export function workstreamEventFromRow(row: DatabaseRow): WorkstreamEvent {
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

export function releaseSummaryFromRow(row: DatabaseRow): ReleaseSummary {
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

export function sharePackageFromRow(row: DatabaseRow): SharePackageStatus {
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

export class MemoryProjectWorkflowStore {
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
