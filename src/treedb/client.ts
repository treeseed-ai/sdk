import { TreeDbApiError } from './errors.ts';
import type {
	SdkGraphSearchResult,
	TreeDbAuditEvent,
	TreeDbAuthMode,
	TreeDbBlob,
	TreeDbBlobDeleteRequest,
	TreeDbBlobDownload,
	TreeDbBlobDownloadRequest,
	TreeDbBlobMutationResult,
	TreeDbBlobReadRequest,
	TreeDbBlobUploadRequest,
	TreeDbBlobWriteRequest,
	TreeDbCapabilityGrant,
	TreeDbCommitRequest,
	TreeDbCommitResult,
	TreeDbContextRequest,
	TreeDbContextResult,
	TreeDbCtxParseRequest,
	TreeDbCtxParseResult,
	TreeDbDiff,
	TreeDbEffectiveScope,
	TreeDbEffectiveScopeRequest,
	TreeDbExecRequest,
	TreeDbExecResult,
	TreeDbFetchRemoteRequest,
	TreeDbFetchRemoteResult,
	TreeDbFederatedContextRequest,
	TreeDbFederatedContextResult,
	TreeDbFederatedGraphRequest,
	TreeDbFederatedGraphResult,
	TreeDbFederatedQueryRequest,
	TreeDbFederatedQueryResult,
	TreeDbFederatedSearchRequest,
	TreeDbFederatedSearchResult,
	TreeDbArtifact,
	TreeDbArtifactDownload,
	TreeDbArtifactExportRequest,
	TreeDbFederationQueryPlan,
	TreeDbFederationQueryPlanRequest,
	TreeDbFile,
	TreeDbFileMutationResult,
	TreeDbGraphNodeRequest,
	TreeDbGraphQueryRequest,
	TreeDbGraphQueryResult,
	TreeDbGraphRefreshJob,
	TreeDbGraphRefreshJobRequest,
	TreeDbGraphRefreshRequest,
	TreeDbGraphRefreshResult,
	TreeDbGraphRelatedRequest,
	TreeDbGraphSearchRequest,
	TreeDbGraphSubgraphRequest,
	TreeDbHealth,
	TreeDbListTreeRequest,
	TreeDbMigration,
	TreeDbMigrationRequest,
	TreeDbMirrorHealthRequest,
	TreeDbMirrorHealthResult,
	TreeDbMirrorPromotionRequest,
	TreeDbMirrorPromotionResult,
	TreeDbMirrorSyncRequest,
	TreeDbMirrorSyncResult,
	TreeDbNode,
	TreeDbPatchFileRequest,
	TreeDbReadFileRequest,
	TreeDbRepository,
	TreeDbRepositoryPathsRequest,
	TreeDbRepositoryPlacement,
	TreeDbRepositoryQueryRequest,
	TreeDbRepositoryQueryResult,
	TreeDbRepositoryReadRequest,
	TreeDbRepositorySearchRequest,
	TreeDbSearchRequest,
	TreeDbSearchIndexCompactRequest,
	TreeDbSearchIndexCompactResult,
	TreeDbSearchIndexRefreshRequest,
	TreeDbSearchIndexRefreshResult,
	TreeDbSearchIndexStatus,
	TreeDbSearchIndexStatusRequest,
	TreeDbSearchResult,
	TreeDbSnapshot,
	TreeDbSnapshotBuildRequest,
	TreeDbStorageBackupRequest,
	TreeDbStorageBackupResult,
	TreeDbStorageCompactRequest,
	TreeDbStorageCompactResult,
	TreeDbStatus,
	TreeDbTreeEntry,
	TreeDbClientOptions,
	TreeDbPushRequest,
	TreeDbPushResult,
	TreeDbWhoami,
	TreeDbWorkspace,
	TreeDbCreateWorkspaceRequest,
	TreeDbDeleteFileRequest,
	TreeDbWorkspaceRequest,
	TreeDbWriteFileRequest,
} from './types.ts';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function normalizeBaseUrl(baseUrl: string) {
	return baseUrl.replace(/\/+$/u, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripOk<T>(payload: unknown): T {
	if (!isRecord(payload)) {
		return payload as T;
	}
	const { ok: _ok, ...rest } = payload;
	return rest as T;
}

function firstPayload<T>(payload: unknown, keys: string[]): T {
	if (isRecord(payload)) {
		for (const key of keys) {
			if (key in payload) {
				return payload[key] as T;
			}
		}
	}
	return stripOk<T>(payload);
}

export class TreeDbClient {
	readonly baseUrl: string;
	private readonly token?: string;
	private readonly defaultRepoId?: string;
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly options: TreeDbClientOptions) {
		this.baseUrl = normalizeBaseUrl(options.baseUrl);
		this.token = options.token;
		this.defaultRepoId = options.repoId;
		this.fetchImpl = options.fetch ?? fetch;
	}

	private repoId(inputRepoId?: string) {
		const repoId = inputRepoId ?? this.defaultRepoId;
		if (!repoId) {
			throw new TreeDbApiError('TreeDB repository ID is required.', {
				status: 400,
				code: 'missing_repo_id',
			});
		}
		return repoId;
	}

	private query(params: Record<string, unknown> = {}) {
		const search = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null) {
				continue;
			}
			search.set(key, String(value));
		}
		const rendered = search.toString();
		return rendered ? `?${rendered}` : '';
	}

	private headers(bodyPresent: boolean) {
		const headers: Record<string, string> = {
			accept: 'application/json',
		};
		if (bodyPresent) {
			headers['content-type'] = 'application/json';
		}
		if (this.token) {
			headers.authorization = `Bearer ${this.token}`;
		}
		return headers;
	}

	private async request<T>(
		method: HttpMethod,
		path: string,
		body?: unknown,
		options: {
			query?: Record<string, string | number | boolean | null | undefined>;
			tokenRequired?: boolean;
		} = {},
	): Promise<T> {
		if (options.tokenRequired && !this.token) {
			throw new TreeDbApiError('TreeDB bearer token is required.', {
				status: 401,
				code: 'missing_token',
			});
		}
		const response = await this.fetchImpl(`${this.baseUrl}${path}${this.query(options.query ?? {})}`, {
			method,
			headers: this.headers(body !== undefined),
			body: body === undefined ? undefined : JSON.stringify(body),
		}).catch((error: unknown) => {
			throw new TreeDbApiError(error instanceof Error ? error.message : 'TreeDB network request failed.', {
				status: 0,
				code: 'network_error',
				payload: error,
			});
		});

		let payload: unknown;
		try {
			payload = await response.json();
		} catch (error) {
			throw new TreeDbApiError('TreeDB response was not valid JSON.', {
				status: response.status,
				code: 'invalid_response',
				payload: error,
			});
		}

		if (!response.ok || (isRecord(payload) && payload.ok === false)) {
			const errorBody = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
			throw new TreeDbApiError(
				typeof errorBody.message === 'string'
					? errorBody.message
					: `TreeDB request failed with status ${response.status}.`,
				{
					status: response.status,
					code: typeof errorBody.code === 'string' ? errorBody.code : 'treedb_api_error',
					details: isRecord(errorBody.details) ? errorBody.details : {},
					payload,
				},
			);
		}

		return stripOk<T>(payload);
	}

	private async requestBinary(
		path: string,
		body: unknown,
		options: {
			query?: Record<string, string | number | boolean | null | undefined>;
			tokenRequired?: boolean;
		} = {},
	): Promise<TreeDbArtifactDownload> {
		if (options.tokenRequired && !this.token) {
			throw new TreeDbApiError('TreeDB bearer token is required.', {
				status: 401,
				code: 'missing_token',
			});
		}
		const response = await this.fetchImpl(`${this.baseUrl}${path}${this.query({ ...options.query, download: true })}`, {
			method: 'POST',
			headers: this.headers(true),
			body: JSON.stringify(body),
		}).catch((error: unknown) => {
			throw new TreeDbApiError(error instanceof Error ? error.message : 'TreeDB network request failed.', {
				status: 0,
				code: 'network_error',
				payload: error,
			});
		});

		if (!response.ok) {
			let payload: unknown;
			try {
				payload = await response.json();
			} catch {
				payload = undefined;
			}
			const errorBody = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
			throw new TreeDbApiError(
				typeof errorBody.message === 'string'
					? errorBody.message
					: `TreeDB request failed with status ${response.status}.`,
				{
					status: response.status,
					code: typeof errorBody.code === 'string' ? errorBody.code : 'treedb_api_error',
					details: isRecord(errorBody.details) ? errorBody.details : {},
					payload,
				},
			);
		}

		const content = await response.arrayBuffer();
		const contentDisposition = response.headers.get('content-disposition');
		return {
			content,
			contentType: response.headers.get('content-type'),
			filename: parseFilename(contentDisposition),
			checksum: response.headers.get('x-treedb-artifact-checksum') ?? undefined,
			snapshotId: response.headers.get('x-treedb-snapshot-id') ?? undefined,
		};
	}

	private async requestBlobDownload(input: TreeDbBlobDownloadRequest): Promise<TreeDbBlobDownload> {
		if (!this.token) {
			throw new TreeDbApiError('TreeDB bearer token is required.', {
				status: 401,
				code: 'missing_token',
			});
		}
		const response = await this.fetchImpl(
			`${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/blobs/download${this.query({
				path: input.path,
				allowProtected: input.allowProtected,
			})}`,
			{
				method: 'GET',
				headers: this.headers(false),
			},
		).catch((error: unknown) => {
			throw new TreeDbApiError(error instanceof Error ? error.message : 'TreeDB network request failed.', {
				status: 0,
				code: 'network_error',
				payload: error,
			});
		});

		await this.assertBinaryOk(response);
		return {
			content: await response.arrayBuffer(),
			contentType: response.headers.get('content-type'),
			contentHash: response.headers.get('x-treedb-content-hash') ?? undefined,
			objectId: response.headers.get('x-treedb-object-id') ?? undefined,
			source: response.headers.get('x-treedb-source') as TreeDbBlobDownload['source'] | undefined,
		};
	}

	private async requestBlobUpload(input: TreeDbBlobUploadRequest): Promise<TreeDbBlobMutationResult> {
		if (!this.token) {
			throw new TreeDbApiError('TreeDB bearer token is required.', {
				status: 401,
				code: 'missing_token',
			});
		}
		const headers: Record<string, string> = {
			accept: 'application/json',
			'content-type': input.contentType ?? 'application/octet-stream',
		};
		if (this.token) {
			headers.authorization = `Bearer ${this.token}`;
		}
		if (input.expectedSha) {
			headers['x-treedb-expected-sha'] = input.expectedSha;
		}
		if (input.expectedContentHash) {
			headers['x-treedb-expected-content-hash'] = input.expectedContentHash;
		}
		if (input.allowProtected !== undefined) {
			headers['x-treedb-allow-protected'] = String(input.allowProtected);
		}

		const response = await this.fetchImpl(
			`${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/blobs/upload${this.query({
				path: input.path,
			})}`,
			{
				method: 'PUT',
				headers,
				body: input.content,
			},
		).catch((error: unknown) => {
			throw new TreeDbApiError(error instanceof Error ? error.message : 'TreeDB network request failed.', {
				status: 0,
				code: 'network_error',
				payload: error,
			});
		});

		const payload = await this.parseJsonResponse(response);
		if (!response.ok || (isRecord(payload) && payload.ok === false)) {
			this.throwApiError(response, payload);
		}
		return firstPayload<TreeDbBlobMutationResult>(payload, ['result']);
	}

	private async assertBinaryOk(response: Response): Promise<void> {
		if (response.ok) {
			return;
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			payload = undefined;
		}
		this.throwApiError(response, payload);
	}

	private async parseJsonResponse(response: Response): Promise<unknown> {
		try {
			return await response.json();
		} catch (error) {
			throw new TreeDbApiError('TreeDB response was not valid JSON.', {
				status: response.status,
				code: 'invalid_response',
				payload: error,
			});
		}
	}

	private throwApiError(response: Response, payload: unknown): never {
		const errorBody = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
		throw new TreeDbApiError(
			typeof errorBody.message === 'string'
				? errorBody.message
				: `TreeDB request failed with status ${response.status}.`,
			{
				status: response.status,
				code: typeof errorBody.code === 'string' ? errorBody.code : 'treedb_api_error',
				details: isRecord(errorBody.details) ? errorBody.details : {},
				payload,
			},
		);
	}

	health(): Promise<TreeDbHealth> {
		return this.request<TreeDbHealth>('GET', '/api/v1/health');
	}

	whoami(): Promise<TreeDbWhoami> {
		return this.request<TreeDbWhoami>('GET', '/api/v1/auth/whoami');
	}

	authMode(): Promise<TreeDbAuthMode> {
		return this.request<TreeDbAuthMode>('GET', '/api/v1/auth/mode');
	}

	effectiveScope(input: TreeDbEffectiveScopeRequest = {}): Promise<TreeDbEffectiveScope> {
		return this.request<TreeDbEffectiveScope>('GET', '/api/v1/policy/effective-scope', undefined, {
			query: { repoId: input.repoId },
			tokenRequired: true,
		});
	}

	listCapabilities(): Promise<{ capabilities: string[] }> {
		return this.request<{ capabilities: string[] }>('GET', '/api/v1/policy/capabilities', undefined, { tokenRequired: true });
	}

	listCapabilityGrants(input: { actorId?: string; repoId?: string } = {}): Promise<TreeDbCapabilityGrant[]> {
		return this.request<Record<string, unknown>>('GET', '/api/v1/policy/grants', undefined, {
			query: input,
			tokenRequired: true,
		}).then((payload) => firstPayload<TreeDbCapabilityGrant[]>(payload, ['grants']));
	}

	putCapabilityGrant(input: TreeDbCapabilityGrant): Promise<TreeDbCapabilityGrant> {
		return this.request<Record<string, unknown>>('POST', '/api/v1/policy/grants', input, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbCapabilityGrant>(payload, ['grant']));
	}

	listAuditEvents(input: {
		actorId?: string;
		tenantId?: string;
		repoId?: string;
		eventType?: string;
		limit?: number;
	} = {}): Promise<{ events: TreeDbAuditEvent[]; page: { limit: number; hasMore: boolean } }> {
		return this.request<{ events: TreeDbAuditEvent[]; page: { limit: number; hasMore: boolean } }>(
			'GET',
			'/api/v1/audit/events',
			undefined,
			{ query: input, tokenRequired: true },
		);
	}

	planFederatedQuery(input: TreeDbFederationQueryPlanRequest): Promise<TreeDbFederationQueryPlan> {
		return this.request<TreeDbFederationQueryPlan>('POST', '/api/v1/federation/query/plan', input, { tokenRequired: true });
	}

	buildSnapshot(input: TreeDbSnapshotBuildRequest = {}): Promise<TreeDbSnapshot> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/snapshots/build`, body, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbSnapshot>(payload, ['snapshot']));
	}

	getSnapshot(input: { repoId?: string; snapshotId: string }): Promise<TreeDbSnapshot> {
		return this.request<Record<string, unknown>>(
			'GET',
			`/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/snapshots/${encodeURIComponent(input.snapshotId)}`,
			undefined,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDbSnapshot>(payload, ['snapshot']));
	}

	exportArtifact(input: TreeDbArtifactExportRequest = {}): Promise<TreeDbArtifact> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/artifacts/export`, body, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbArtifact>(payload, ['artifact']));
	}

	downloadArtifact(input: TreeDbArtifactExportRequest = {}): Promise<TreeDbArtifactDownload> {
		const { repoId, ...body } = input;
		return this.requestBinary(`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/artifacts/export`, body, {
			tokenRequired: true,
		});
	}

	syncMirror(input: TreeDbMirrorSyncRequest): Promise<TreeDbMirrorSyncResult> {
		const { repoId, mirrorId, ...body } = input;
		return this.request<TreeDbMirrorSyncResult>(
			'POST',
			`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/mirrors/${encodeURIComponent(mirrorId)}/sync`,
			body,
			{ tokenRequired: true },
		);
	}

	fetchRemote(input: TreeDbFetchRemoteRequest): Promise<TreeDbFetchRemoteResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDbFetchRemoteResult>(
			'POST',
			`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/sync`,
			body,
			{ tokenRequired: true },
		);
	}

	push(input: TreeDbPushRequest): Promise<TreeDbPushResult> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>(
			'POST',
			`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/push`,
			body,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDbPushResult>(payload, ['push']));
	}

	checkMirrorHealth(input: TreeDbMirrorHealthRequest): Promise<TreeDbMirrorHealthResult> {
		const { repoId, mirrorId } = input;
		return this.request<TreeDbMirrorHealthResult>(
			'POST',
			`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/mirrors/${encodeURIComponent(mirrorId)}/health`,
			{},
			{ tokenRequired: true },
		);
	}

	promoteMirror(input: TreeDbMirrorPromotionRequest): Promise<TreeDbMirrorPromotionResult> {
		const { repoId, mirrorId, ...body } = input;
		return this.request<TreeDbMirrorPromotionResult>(
			'POST',
			`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/mirrors/${encodeURIComponent(mirrorId)}/promote`,
			body,
			{ tokenRequired: true },
		);
	}

	compactStorage(input: TreeDbStorageCompactRequest = {}): Promise<TreeDbStorageCompactResult> {
		return this.request<TreeDbStorageCompactResult>('POST', '/api/v1/admin/storage/compact', input, {
			tokenRequired: true,
		});
	}

	backupStorage(input: TreeDbStorageBackupRequest = {}): Promise<TreeDbStorageBackupResult> {
		return this.request<TreeDbStorageBackupResult>('POST', '/api/v1/admin/storage/backup', input, {
			tokenRequired: true,
		});
	}

	createMigration(input: TreeDbMigrationRequest): Promise<{ migration: TreeDbMigration; placement?: TreeDbRepositoryPlacement }> {
		const { repoId, ...body } = input;
		return this.request<{ migration: TreeDbMigration; placement?: TreeDbRepositoryPlacement }>(
			'POST',
			`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/migrations`,
			body,
			{ tokenRequired: true },
		);
	}

	getMigration(input: { repoId?: string; migrationId: string }): Promise<TreeDbMigration> {
		return this.request<Record<string, unknown>>(
			'GET',
			`/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/migrations/${encodeURIComponent(input.migrationId)}`,
			undefined,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDbMigration>(payload, ['migration']));
	}

	getNode(): Promise<TreeDbNode> {
		return this.request<Record<string, unknown>>('GET', '/api/v1/node', undefined, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbNode>(payload, ['node']));
	}

	listNodes(): Promise<TreeDbNode[]> {
		return this.request<Record<string, unknown>>('GET', '/api/v1/registry/nodes', undefined, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbNode[]>(payload, ['nodes']));
	}

	getPlacement(repoId: string): Promise<TreeDbRepositoryPlacement> {
		return this.request<Record<string, unknown>>('GET', `/api/v1/registry/repos/${encodeURIComponent(repoId)}/placement`, undefined, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbRepositoryPlacement>(payload, ['placement']));
	}

	getRepository(repoId?: string): Promise<TreeDbRepository> {
		return this.request<Record<string, unknown>>('GET', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}`, undefined, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbRepository>(payload, ['repo']));
	}

	createWorkspace(input: TreeDbCreateWorkspaceRequest): Promise<TreeDbWorkspace> {
		const { repoId, ...body } = input;
		return this.request<TreeDbWorkspace>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/workspaces`, body, { tokenRequired: true });
	}

	async closeWorkspace(workspaceId: string): Promise<void> {
		await this.request<Record<string, unknown>>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/close`, {}, { tokenRequired: true });
	}

	listTree(input: TreeDbListTreeRequest): Promise<TreeDbTreeEntry[]> {
		return this.request<Record<string, unknown>>('GET', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/tree`, undefined, {
			query: { path: input.path ?? '', includeDeleted: input.includeDeleted },
			tokenRequired: true,
		}).then((payload) => firstPayload<TreeDbTreeEntry[]>(payload, ['entries']));
	}

	readFile(input: TreeDbReadFileRequest): Promise<TreeDbFile> {
		return this.request<TreeDbFile>('GET', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/files`, undefined, {
			query: { path: input.path, allowProtected: input.allowProtected },
			tokenRequired: true,
		});
	}

	writeFile(input: TreeDbWriteFileRequest): Promise<TreeDbFileMutationResult> {
		const { workspaceId, path, ...body } = input;
		return this.request<TreeDbFileMutationResult>('PUT', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/files`, body, {
			query: { path },
			tokenRequired: true,
		});
	}

	patchFile(input: TreeDbPatchFileRequest): Promise<TreeDbFileMutationResult> {
		const { workspaceId, path, ...body } = input;
		return this.request<TreeDbFileMutationResult>('PATCH', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/files`, body, {
			query: { path },
			tokenRequired: true,
		});
	}

	deleteFile(input: TreeDbDeleteFileRequest): Promise<TreeDbFileMutationResult> {
		const { workspaceId, path, ...body } = input;
		return this.request<TreeDbFileMutationResult>('DELETE', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/files`, body, {
			query: { path },
			tokenRequired: true,
		});
	}

	readBlob(input: TreeDbBlobReadRequest): Promise<TreeDbBlob> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/blobs/read`, body, {
			tokenRequired: true,
		}).then((payload) => firstPayload<TreeDbBlob>(payload, ['blob']));
	}

	writeBlob(input: TreeDbBlobWriteRequest): Promise<TreeDbBlobMutationResult> {
		const { workspaceId, path, ...body } = input;
		return this.request<Record<string, unknown>>(
			'POST',
			`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/blobs/write`,
			{ path, ...body, encoding: body.encoding ?? 'base64' },
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDbBlobMutationResult>(payload, ['result']));
	}

	deleteBlob(input: TreeDbBlobDeleteRequest): Promise<TreeDbBlobMutationResult> {
		const { workspaceId, ...body } = input;
		return this.request<Record<string, unknown>>(
			'POST',
			`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/blobs/delete`,
			body,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDbBlobMutationResult>(payload, ['result']));
	}

	downloadBlob(input: TreeDbBlobDownloadRequest): Promise<TreeDbBlobDownload> {
		return this.requestBlobDownload(input);
	}

	uploadBlob(input: TreeDbBlobUploadRequest): Promise<TreeDbBlobMutationResult> {
		return this.requestBlobUpload(input);
	}

	search(input: TreeDbSearchRequest): Promise<TreeDbSearchResult> {
		const { workspaceId, ...body } = input;
		return this.request<TreeDbSearchResult>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/search`, body, { tokenRequired: true });
	}

	status(input: TreeDbWorkspaceRequest): Promise<TreeDbStatus> {
		return this.request<TreeDbStatus>('GET', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/status`, undefined, { tokenRequired: true });
	}

	diff(input: TreeDbWorkspaceRequest): Promise<TreeDbDiff> {
		return this.request<TreeDbDiff>('GET', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/diff`, undefined, { tokenRequired: true });
	}

	commit(input: TreeDbCommitRequest): Promise<TreeDbCommitResult> {
		const { workspaceId, ...body } = input;
		return this.request<TreeDbCommitResult>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/commit`, body, { tokenRequired: true });
	}

	exec(input: TreeDbExecRequest): Promise<TreeDbExecResult> {
		const { workspaceId, ...body } = input;
		return this.request<TreeDbExecResult>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/exec`, body, { tokenRequired: true });
	}

	readRepositoryFiles(input: TreeDbRepositoryReadRequest): Promise<TreeDbRepositoryQueryResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDbRepositoryQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/files/read`, body, { tokenRequired: true });
	}

	readRepositoryFile(input: TreeDbRepositoryReadRequest): Promise<TreeDbRepositoryQueryResult> {
		return this.readRepositoryFiles(input);
	}

	listRepositoryPaths(input: TreeDbRepositoryPathsRequest): Promise<TreeDbRepositoryQueryResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDbRepositoryQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/paths/list`, body, { tokenRequired: true });
	}

	searchRepositoryFiles(input: TreeDbRepositorySearchRequest): Promise<TreeDbRepositoryQueryResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDbRepositoryQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/files/search`, body, { tokenRequired: true });
	}

	queryRepository(input: TreeDbRepositoryQueryRequest): Promise<TreeDbRepositoryQueryResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDbRepositoryQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/query`, body, { tokenRequired: true });
	}

	federatedSearch(input: TreeDbFederatedSearchRequest): Promise<TreeDbFederatedSearchResult> {
		return this.request<Record<string, unknown>>('POST', '/api/v1/search', input, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbFederatedSearchResult>(payload, ['search']));
	}

	federatedQuery(input: TreeDbFederatedQueryRequest): Promise<TreeDbFederatedQueryResult> {
		return this.request<Record<string, unknown>>('POST', '/api/v1/query', input, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbFederatedQueryResult>(payload, ['query']));
	}

	federatedContext(input: TreeDbFederatedContextRequest): Promise<TreeDbFederatedContextResult> {
		return this.request<Record<string, unknown>>('POST', '/api/v1/context/build', input, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbFederatedContextResult>(payload, ['context']));
	}

	federatedGraph(input: TreeDbFederatedGraphRequest): Promise<TreeDbFederatedGraphResult> {
		return this.request<Record<string, unknown>>('POST', '/api/v1/graph/query', input, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbFederatedGraphResult>(payload, ['graph']));
	}

	refreshGraph(input: TreeDbGraphRefreshRequest = {}): Promise<TreeDbGraphRefreshResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDbGraphRefreshResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/graph/refresh`, body, { tokenRequired: true });
	}

	getGraphRefreshJob(input: TreeDbGraphRefreshJobRequest): Promise<TreeDbGraphRefreshJob> {
		return this.request<Record<string, unknown>>(
			'GET',
			`/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/graph/refresh-jobs/${encodeURIComponent(input.jobId)}`,
			undefined,
			{ query: { ref: input.ref }, tokenRequired: true },
		).then((payload) => firstPayload<TreeDbGraphRefreshJob>(payload, ['job']));
	}

	refreshSearchIndex(input: TreeDbSearchIndexRefreshRequest = {}): Promise<TreeDbSearchIndexRefreshResult> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/search/index/refresh`, body, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbSearchIndexRefreshResult>(payload, ['index']));
	}

	getSearchIndexStatus(input: TreeDbSearchIndexStatusRequest = {}): Promise<TreeDbSearchIndexStatus> {
		return this.request<Record<string, unknown>>(
			'GET',
			`/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/search/index/status`,
			undefined,
			{ query: { ref: input.ref }, tokenRequired: true },
		).then((payload) => firstPayload<TreeDbSearchIndexStatus>(payload, ['index']));
	}

	compactSearchIndex(input: TreeDbSearchIndexCompactRequest = {}): Promise<TreeDbSearchIndexCompactResult> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/search/index/compact`, body, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDbSearchIndexCompactResult>(payload, ['compact']));
	}

	queryGraph(input: TreeDbGraphQueryRequest): Promise<TreeDbGraphQueryResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDbGraphQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/graph/query`, body, { tokenRequired: true });
	}

	searchGraphFiles(input: TreeDbGraphSearchRequest): Promise<SdkGraphSearchResult[]> {
		return this.graphSearch('/graph/search-files', input);
	}

	searchGraphSections(input: TreeDbGraphSearchRequest): Promise<SdkGraphSearchResult[]> {
		return this.graphSearch('/graph/search-sections', input);
	}

	searchGraphEntities(input: TreeDbGraphSearchRequest): Promise<SdkGraphSearchResult[]> {
		return this.graphSearch('/graph/search-entities', input);
	}

	getGraphNode(input: TreeDbGraphNodeRequest) {
		return this.request<Record<string, unknown>>('GET', `/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/graph/nodes/${encodeURIComponent(input.nodeId)}`, undefined, {
			query: { ref: input.ref },
			tokenRequired: true,
		}).then((payload) => firstPayload(payload, ['node']));
	}

	getRelated(input: TreeDbGraphRelatedRequest) {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/graph/related`, body, { tokenRequired: true });
	}

	getSubgraph(input: TreeDbGraphSubgraphRequest) {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/graph/subgraph`, body, { tokenRequired: true });
	}

	buildContext(input: TreeDbContextRequest): Promise<TreeDbContextResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDbContextResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/context/build`, body, { tokenRequired: true });
	}

	parseContextDsl(input: TreeDbCtxParseRequest): Promise<TreeDbCtxParseResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDbCtxParseResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/context/parse-ctx`, body, { tokenRequired: true });
	}

	private graphSearch(path: string, input: TreeDbGraphSearchRequest): Promise<SdkGraphSearchResult[]> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}${path}`, body, { tokenRequired: true })
			.then((payload) => firstPayload<SdkGraphSearchResult[]>(payload, ['results']));
	}
}

function parseFilename(contentDisposition: string | null) {
	if (!contentDisposition) {
		return undefined;
	}
	const match = /filename="([^"]+)"/u.exec(contentDisposition) ?? /filename=([^;]+)/u.exec(contentDisposition);
	return match?.[1];
}
