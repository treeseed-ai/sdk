import { TreeDxApiError } from './errors.ts';
import type {
	SdkGraphSearchResult,
	TreeDxAuditEvent,
	TreeDxAuthMode,
	TreeDxBlob,
	TreeDxBlobUploadAbortRequest,
	TreeDxBlobUploadCompleteRequest,
	TreeDxBlobUploadCreateRequest,
	TreeDxBlobUploadPart,
	TreeDxBlobUploadPartRequest,
	TreeDxBlobUploadSession,
	TreeDxBlobDeleteRequest,
	TreeDxBlobDownload,
	TreeDxBlobDownloadRequest,
	TreeDxBlobMutationResult,
	TreeDxBlobReadRequest,
	TreeDxBlobUploadRequest,
	TreeDxBlobWriteRequest,
	TreeDxCapabilityGrant,
	TreeDxCommitRequest,
	TreeDxCommitResult,
	TreeDxContextRequest,
	TreeDxContextResult,
	TreeDxCtxParseRequest,
	TreeDxCtxParseResult,
	TreeDxDiff,
	TreeDxEffectiveScope,
	TreeDxEffectiveScopeRequest,
	TreeDxExecRequest,
	TreeDxExecResult,
	TreeDxFetchRemoteRequest,
	TreeDxFetchRemoteResult,
	TreeDxFederatedContextRequest,
	TreeDxFederatedContextResult,
	TreeDxFederatedGraphRequest,
	TreeDxFederatedGraphResult,
	TreeDxFederatedQueryRequest,
	TreeDxFederatedQueryResult,
	TreeDxFederatedSearchRequest,
	TreeDxFederatedSearchResult,
	TreeDxArtifact,
	TreeDxArtifactCleanupRequest,
	TreeDxArtifactCleanupResult,
	TreeDxArtifactDeleteRequest,
	TreeDxArtifactDownload,
	TreeDxArtifactExportRequest,
	TreeDxArtifactGetRequest,
	TreeDxArtifactListRequest,
	TreeDxFederationQueryPlan,
	TreeDxFederationQueryPlanRequest,
	TreeDxFile,
	TreeDxFileMutationResult,
	TreeDxGraphNodeRequest,
	TreeDxGraphQueryRequest,
	TreeDxGraphQueryResult,
	TreeDxGraphRefreshJob,
	TreeDxGraphRefreshJobRequest,
	TreeDxGraphRefreshRequest,
	TreeDxGraphRefreshResult,
	TreeDxGraphRelatedRequest,
	TreeDxGraphSearchRequest,
	TreeDxGraphSubgraphRequest,
	TreeDxHealth,
	TreeDxListTreeRequest,
	TreeDxMigration,
	TreeDxMigrationRequest,
	TreeDxMirrorHealthRequest,
	TreeDxMirrorHealthResult,
	TreeDxMirrorPromotionRequest,
	TreeDxMirrorPromotionResult,
	TreeDxMirrorSyncRequest,
	TreeDxMirrorSyncResult,
	TreeDxNode,
	TreeDxPatchFileRequest,
	TreeDxReadFileRequest,
	TreeDxRepository,
	TreeDxRepositoryPathsRequest,
	TreeDxRepositoryPlacement,
	TreeDxRepositoryQueryRequest,
	TreeDxRepositoryQueryResult,
	TreeDxRepositoryReadRequest,
	TreeDxRepositorySearchRequest,
	TreeDxSearchRequest,
	TreeDxSearchIndexCompactRequest,
	TreeDxSearchIndexCompactResult,
	TreeDxSearchIndexRefreshRequest,
	TreeDxSearchIndexRefreshResult,
	TreeDxSearchIndexStatus,
	TreeDxSearchIndexStatusRequest,
	TreeDxSearchResult,
	TreeDxSnapshot,
	TreeDxSnapshotBuildRequest,
	TreeDxStorageBackupRequest,
	TreeDxStorageBackupResult,
	TreeDxStorageCompactRequest,
	TreeDxStorageCompactResult,
	TreeDxStorageMigration,
	TreeDxStorageMigrationPlanRequest,
	TreeDxStorageMigrationRollbackRequest,
	TreeDxStorageRestoreRequest,
	TreeDxStorageRestoreResult,
	TreeDxStorageRestoreVerifyRequest,
	TreeDxStatus,
	TreeDxTreeEntry,
	TreeDxClientOptions,
	TreeDxPushRequest,
	TreeDxPushResult,
	TreeDxWhoami,
	TreeDxWorkspace,
	TreeDxCreateWorkspaceRequest,
	TreeDxDeleteFileRequest,
	TreeDxDeepHealth,
	TreeDxWorkspaceRequest,
	TreeDxWriteFileRequest,
	TreeDxMetrics,
	TreeDxReadiness,
} from './types.ts';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function normalizeBaseUrl(baseUrl: string) {
	return baseUrl.replace(/\/+$/u, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === 'AbortError'
		|| error instanceof Error && error.name === 'AbortError';
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

export const TREEDX_CLIENT_OPERATION_MAP = {
	health: 'getHealth',
	ready: 'getReadiness',
	deepHealth: 'getDeepHealth',
	adminDeepHealth: 'getAdminDeepHealth',
	metrics: 'getMetrics',
	prometheusMetrics: 'getPrometheusMetrics',
	whoami: 'getWhoami',
	authMode: 'getAuthMode',
	effectiveScope: 'getEffectiveScope',
	listCapabilities: 'listCapabilities',
	listCapabilityGrants: 'listCapabilityGrants',
	putCapabilityGrant: 'putCapabilityGrant',
	listAuditEvents: 'listAuditEvents',
	planFederatedQuery: 'planFederationQuery',
	buildSnapshot: 'buildSnapshot',
	getSnapshot: 'getSnapshot',
	exportArtifact: 'exportArtifact',
	syncMirror: 'syncMirror',
	fetchRemote: 'syncRepository',
	push: 'pushRepository',
	checkMirrorHealth: 'checkMirrorHealth',
	promoteMirror: 'promoteMirror',
	compactStorage: 'compactAdminStorage',
	backupStorage: 'backupAdminStorage',
	listStorageMigrations: 'listStorageMigrations',
	planStorageMigration: 'planStorageMigration',
	applyStorageMigration: 'applyStorageMigration',
	rollbackStorageMigration: 'rollbackStorageMigration',
	verifyStorageRestore: 'verifyStorageRestore',
	restoreStorage: 'restoreStorage',
	createMigration: 'createMigration',
	getMigration: 'getMigration',
	getNode: 'getLocalNode',
	listNodes: 'listRegistryNodes',
	getPlacement: 'getRepositoryPlacement',
	getRepository: 'getRepository',
	createWorkspace: 'createWorkspace',
	closeWorkspace: 'closeWorkspace',
	listTree: 'listWorkspaceTree',
	readFile: 'readWorkspaceFile',
	writeFile: 'writeWorkspaceFile',
	patchFile: 'patchWorkspaceFile',
	deleteFile: 'deleteWorkspaceFile',
	readBlob: 'readRepositoryBlob',
	writeBlob: 'writeWorkspaceBlob',
	deleteBlob: 'deleteWorkspaceBlob',
	downloadBlob: 'downloadWorkspaceBlob',
	uploadBlob: 'uploadWorkspaceBlob',
	createBlobUpload: 'createWorkspaceBlobUpload',
	uploadBlobPart: 'uploadWorkspaceBlobPart',
	completeBlobUpload: 'completeWorkspaceBlobUpload',
	abortBlobUpload: 'abortWorkspaceBlobUpload',
	listArtifacts: 'listArtifacts',
	getArtifact: 'getArtifact',
	deleteArtifact: 'deleteArtifact',
	cleanupArtifacts: 'cleanupArtifacts',
	search: 'searchWorkspace',
	status: 'getWorkspaceStatus',
	diff: 'getWorkspaceDiff',
	commit: 'commitWorkspace',
	exec: 'execWorkspace',
	readRepositoryFiles: 'readRepositoryFile',
	readRepositoryFile: 'readRepositoryFile',
	listRepositoryPaths: 'listRepositoryPaths',
	searchRepositoryFiles: 'searchRepositoryFiles',
	queryRepository: 'queryRepository',
	federatedSearch: 'federatedSearch',
	federatedQuery: 'federatedQuery',
	federatedContext: 'federatedContextBuild',
	federatedGraph: 'federatedGraphQuery',
	refreshGraph: 'refreshRepositoryGraph',
	getGraphRefreshJob: 'getGraphRefreshJob',
	refreshSearchIndex: 'refreshSearchIndex',
	getSearchIndexStatus: 'getSearchIndexStatus',
	compactSearchIndex: 'compactSearchIndex',
	queryGraph: 'queryRepositoryGraph',
	searchGraphFiles: 'searchGraphFiles',
	searchGraphSections: 'searchGraphSections',
	searchGraphEntities: 'searchGraphEntities',
	getGraphNode: 'getGraphNode',
	getRelated: 'getRelatedGraphNodes',
	getSubgraph: 'getGraphSubgraph',
	buildContext: 'buildContext',
	parseContextDsl: 'parseContextQuery',
} as const;

export class TreeDxClient {
	readonly baseUrl: string;
	private readonly token?: string;
	private readonly defaultRepoId?: string;
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly options: TreeDxClientOptions) {
		this.baseUrl = normalizeBaseUrl(options.baseUrl);
		this.token = options.token;
		this.defaultRepoId = options.repoId;
		this.fetchImpl = options.fetch ?? fetch;
	}

	private repoId(inputRepoId?: string) {
		const repoId = inputRepoId ?? this.defaultRepoId;
		if (!repoId) {
			throw new TreeDxApiError('TreeDX repository ID is required.', {
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

	private async fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
		const timeoutMs = this.options.timeoutMs;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let controller: AbortController | undefined;
		if (timeoutMs && timeoutMs > 0) {
			controller = new AbortController();
			timeout = setTimeout(() => controller?.abort(), timeoutMs);
		}
		try {
			return await this.fetchImpl(input, {
				...init,
				signal: controller?.signal ?? init.signal,
			});
		} catch (error: unknown) {
			if (isAbortError(error)) {
				throw new TreeDxApiError(`TreeDX request timed out after ${timeoutMs}ms.`, {
					status: 0,
					code: 'timeout',
					details: { timeoutMs },
					payload: error,
				});
			}
			throw new TreeDxApiError(error instanceof Error ? error.message : 'TreeDX network request failed.', {
				status: 0,
				code: 'network_error',
				payload: error,
			});
		} finally {
			if (timeout) {
				clearTimeout(timeout);
			}
		}
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
			throw new TreeDxApiError('TreeDX bearer token is required.', {
				status: 401,
				code: 'missing_token',
			});
		}
		const response = await this.fetchWithTimeout(`${this.baseUrl}${path}${this.query(options.query ?? {})}`, {
			method,
			headers: this.headers(body !== undefined),
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		let payload: unknown;
		try {
			payload = await response.json();
		} catch (error) {
			throw new TreeDxApiError('TreeDX response was not valid JSON.', {
				status: response.status,
				code: 'invalid_response',
				payload: error,
			});
		}

		if (!response.ok || (isRecord(payload) && payload.ok === false)) {
			const errorBody = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
			throw new TreeDxApiError(
				typeof errorBody.message === 'string'
					? errorBody.message
					: `TreeDX request failed with status ${response.status}.`,
				{
					status: response.status,
					code: typeof errorBody.code === 'string' ? errorBody.code : 'treedx_api_error',
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
	): Promise<TreeDxArtifactDownload> {
		if (options.tokenRequired && !this.token) {
			throw new TreeDxApiError('TreeDX bearer token is required.', {
				status: 401,
				code: 'missing_token',
			});
		}
		const response = await this.fetchWithTimeout(`${this.baseUrl}${path}${this.query({ ...options.query, download: true })}`, {
			method: 'POST',
			headers: this.headers(true),
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			let payload: unknown;
			try {
				payload = await response.json();
			} catch {
				payload = undefined;
			}
			const errorBody = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
			throw new TreeDxApiError(
				typeof errorBody.message === 'string'
					? errorBody.message
					: `TreeDX request failed with status ${response.status}.`,
				{
					status: response.status,
					code: typeof errorBody.code === 'string' ? errorBody.code : 'treedx_api_error',
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
			checksum: response.headers.get('x-treedx-artifact-checksum') ?? undefined,
			snapshotId: response.headers.get('x-treedx-snapshot-id') ?? undefined,
		};
	}

	private async requestBlobDownload(input: TreeDxBlobDownloadRequest): Promise<TreeDxBlobDownload> {
		if (!this.token) {
			throw new TreeDxApiError('TreeDX bearer token is required.', {
				status: 401,
				code: 'missing_token',
			});
		}
		const response = await this.fetchWithTimeout(
			`${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/blobs/download${this.query({
				path: input.path,
				allowProtected: input.allowProtected,
			})}`,
			{
				method: 'GET',
				headers: this.headers(false),
			},
		);

		await this.assertBinaryOk(response);
		return {
			content: await response.arrayBuffer(),
			contentType: response.headers.get('content-type'),
			contentHash: response.headers.get('x-treedx-content-hash') ?? undefined,
			objectId: response.headers.get('x-treedx-object-id') ?? undefined,
			source: response.headers.get('x-treedx-source') as TreeDxBlobDownload['source'] | undefined,
		};
	}

	private async requestBlobUpload(input: TreeDxBlobUploadRequest): Promise<TreeDxBlobMutationResult> {
		if (!this.token) {
			throw new TreeDxApiError('TreeDX bearer token is required.', {
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
			headers['x-treedx-expected-sha'] = input.expectedSha;
		}
		if (input.expectedContentHash) {
			headers['x-treedx-expected-content-hash'] = input.expectedContentHash;
		}
		if (input.allowProtected !== undefined) {
			headers['x-treedx-allow-protected'] = String(input.allowProtected);
		}

		const response = await this.fetchWithTimeout(
			`${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/blobs/upload${this.query({
				path: input.path,
			})}`,
			{
				method: 'PUT',
				headers,
				body: input.content,
			},
		);

		const payload = await this.parseJsonResponse(response);
		if (!response.ok || (isRecord(payload) && payload.ok === false)) {
			this.throwApiError(response, payload);
		}
		return firstPayload<TreeDxBlobMutationResult>(payload, ['result']);
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
			throw new TreeDxApiError('TreeDX response was not valid JSON.', {
				status: response.status,
				code: 'invalid_response',
				payload: error,
			});
		}
	}

	private throwApiError(response: Response, payload: unknown): never {
		const errorBody = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
		throw new TreeDxApiError(
			typeof errorBody.message === 'string'
				? errorBody.message
				: `TreeDX request failed with status ${response.status}.`,
			{
				status: response.status,
				code: typeof errorBody.code === 'string' ? errorBody.code : 'treedx_api_error',
				details: isRecord(errorBody.details) ? errorBody.details : {},
				payload,
			},
		);
	}

	health(): Promise<TreeDxHealth> {
		return this.request<TreeDxHealth>('GET', '/api/v1/health');
	}

	ready(): Promise<TreeDxReadiness> {
		return this.request<Record<string, unknown>>('GET', '/api/v1/ready')
			.then((payload) => firstPayload<TreeDxReadiness>(payload, ['readiness']));
	}

	deepHealth(input: { admin?: boolean } = {}): Promise<TreeDxDeepHealth> {
		return this.request<Record<string, unknown>>(
			'GET',
			input.admin ? '/api/v1/admin/health/deep' : '/api/v1/health/deep',
			undefined,
			{ tokenRequired: input.admin === true },
		).then((payload) => firstPayload<TreeDxDeepHealth>(payload, ['health']));
	}

	metrics(): Promise<TreeDxMetrics> {
		return this.request<Record<string, unknown>>('GET', '/api/v1/metrics')
			.then((payload) => firstPayload<TreeDxMetrics>(payload, ['metrics']));
	}

	async prometheusMetrics(): Promise<string> {
		const response = await this.fetchWithTimeout(`${this.baseUrl}/metrics`, {
			method: 'GET',
			headers: { accept: 'text/plain' },
		});
		if (!response.ok) {
			let payload: unknown;
			try {
				payload = await response.json();
			} catch {
				payload = undefined;
			}
			this.throwApiError(response, payload);
		}
		return response.text();
	}

	whoami(): Promise<TreeDxWhoami> {
		return this.request<TreeDxWhoami>('GET', '/api/v1/auth/whoami');
	}

	authMode(): Promise<TreeDxAuthMode> {
		return this.request<TreeDxAuthMode>('GET', '/api/v1/auth/mode');
	}

	effectiveScope(input: TreeDxEffectiveScopeRequest = {}): Promise<TreeDxEffectiveScope> {
		return this.request<TreeDxEffectiveScope>('GET', '/api/v1/policy/effective-scope', undefined, {
			query: { repoId: input.repoId },
			tokenRequired: true,
		});
	}

	listCapabilities(): Promise<{ capabilities: string[] }> {
		return this.request<{ capabilities: string[] }>('GET', '/api/v1/policy/capabilities', undefined, { tokenRequired: true });
	}

	listCapabilityGrants(input: { actorId?: string; repoId?: string } = {}): Promise<TreeDxCapabilityGrant[]> {
		return this.request<Record<string, unknown>>('GET', '/api/v1/policy/grants', undefined, {
			query: input,
			tokenRequired: true,
		}).then((payload) => firstPayload<TreeDxCapabilityGrant[]>(payload, ['grants']));
	}

	putCapabilityGrant(input: TreeDxCapabilityGrant): Promise<TreeDxCapabilityGrant> {
		return this.request<Record<string, unknown>>('POST', '/api/v1/policy/grants', input, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxCapabilityGrant>(payload, ['grant']));
	}

	listAuditEvents(input: {
		actorId?: string;
		tenantId?: string;
		repoId?: string;
		eventType?: string;
		limit?: number;
	} = {}): Promise<{ events: TreeDxAuditEvent[]; page: { limit: number; hasMore: boolean } }> {
		return this.request<{ events: TreeDxAuditEvent[]; page: { limit: number; hasMore: boolean } }>(
			'GET',
			'/api/v1/audit/events',
			undefined,
			{ query: input, tokenRequired: true },
		);
	}

	planFederatedQuery(input: TreeDxFederationQueryPlanRequest): Promise<TreeDxFederationQueryPlan> {
		return this.request<TreeDxFederationQueryPlan>('POST', '/api/v1/federation/query/plan', input, { tokenRequired: true });
	}

	buildSnapshot(input: TreeDxSnapshotBuildRequest = {}): Promise<TreeDxSnapshot> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/snapshots/build`, body, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxSnapshot>(payload, ['snapshot']));
	}

	getSnapshot(input: { repoId?: string; snapshotId: string }): Promise<TreeDxSnapshot> {
		return this.request<Record<string, unknown>>(
			'GET',
			`/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/snapshots/${encodeURIComponent(input.snapshotId)}`,
			undefined,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxSnapshot>(payload, ['snapshot']));
	}

	exportArtifact(input: TreeDxArtifactExportRequest = {}): Promise<TreeDxArtifact> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/artifacts/export`, body, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxArtifact>(payload, ['artifact']));
	}

	downloadArtifact(input: TreeDxArtifactExportRequest = {}): Promise<TreeDxArtifactDownload> {
		const { repoId, ...body } = input;
		return this.requestBinary(`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/artifacts/export`, body, {
			tokenRequired: true,
		});
	}

	syncMirror(input: TreeDxMirrorSyncRequest): Promise<TreeDxMirrorSyncResult> {
		const { repoId, mirrorId, ...body } = input;
		return this.request<TreeDxMirrorSyncResult>(
			'POST',
			`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/mirrors/${encodeURIComponent(mirrorId)}/sync`,
			body,
			{ tokenRequired: true },
		);
	}

	fetchRemote(input: TreeDxFetchRemoteRequest): Promise<TreeDxFetchRemoteResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDxFetchRemoteResult>(
			'POST',
			`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/sync`,
			body,
			{ tokenRequired: true },
		);
	}

	push(input: TreeDxPushRequest): Promise<TreeDxPushResult> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>(
			'POST',
			`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/push`,
			body,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxPushResult>(payload, ['push']));
	}

	checkMirrorHealth(input: TreeDxMirrorHealthRequest): Promise<TreeDxMirrorHealthResult> {
		const { repoId, mirrorId } = input;
		return this.request<TreeDxMirrorHealthResult>(
			'POST',
			`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/mirrors/${encodeURIComponent(mirrorId)}/health`,
			{},
			{ tokenRequired: true },
		);
	}

	promoteMirror(input: TreeDxMirrorPromotionRequest): Promise<TreeDxMirrorPromotionResult> {
		const { repoId, mirrorId, ...body } = input;
		return this.request<TreeDxMirrorPromotionResult>(
			'POST',
			`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/mirrors/${encodeURIComponent(mirrorId)}/promote`,
			body,
			{ tokenRequired: true },
		);
	}

	compactStorage(input: TreeDxStorageCompactRequest = {}): Promise<TreeDxStorageCompactResult> {
		return this.request<TreeDxStorageCompactResult>('POST', '/api/v1/admin/storage/compact', input, {
			tokenRequired: true,
		});
	}

	backupStorage(input: TreeDxStorageBackupRequest = {}): Promise<TreeDxStorageBackupResult> {
		return this.request<TreeDxStorageBackupResult>('POST', '/api/v1/admin/storage/backup', input, {
			tokenRequired: true,
		});
	}

	listStorageMigrations(): Promise<{ migrations: TreeDxStorageMigration[]; manifest: Record<string, unknown> }> {
		return this.request<{ migrations: TreeDxStorageMigration[]; manifest: Record<string, unknown> }>(
			'GET',
			'/api/v1/admin/storage/migrations',
			undefined,
			{ tokenRequired: true },
		);
	}

	planStorageMigration(input: TreeDxStorageMigrationPlanRequest = {}): Promise<TreeDxStorageMigration> {
		return this.request<Record<string, unknown>>(
			'POST',
			'/api/v1/admin/storage/migrations/plan',
			input,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxStorageMigration>(payload, ['migration']));
	}

	applyStorageMigration(input: TreeDxStorageMigrationPlanRequest = {}): Promise<TreeDxStorageMigration> {
		return this.request<Record<string, unknown>>(
			'POST',
			'/api/v1/admin/storage/migrations/apply',
			input,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxStorageMigration>(payload, ['migration']));
	}

	rollbackStorageMigration(input: TreeDxStorageMigrationRollbackRequest): Promise<TreeDxStorageMigration> {
		return this.request<Record<string, unknown>>(
			'POST',
			'/api/v1/admin/storage/migrations/rollback',
			input,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxStorageMigration>(payload, ['migration']));
	}

	verifyStorageRestore(input: TreeDxStorageRestoreVerifyRequest): Promise<TreeDxStorageRestoreResult['restore']> {
		return this.request<TreeDxStorageRestoreResult>(
			'POST',
			'/api/v1/admin/storage/restore/verify',
			input,
			{ tokenRequired: true },
		).then((payload) => payload.restore);
	}

	restoreStorage(input: TreeDxStorageRestoreRequest): Promise<TreeDxStorageRestoreResult['restore']> {
		return this.request<TreeDxStorageRestoreResult>(
			'POST',
			'/api/v1/admin/storage/restore',
			input,
			{ tokenRequired: true },
		).then((payload) => payload.restore);
	}

	createMigration(input: TreeDxMigrationRequest): Promise<{ migration: TreeDxMigration; placement?: TreeDxRepositoryPlacement }> {
		const { repoId, ...body } = input;
		return this.request<{ migration: TreeDxMigration; placement?: TreeDxRepositoryPlacement }>(
			'POST',
			`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/migrations`,
			body,
			{ tokenRequired: true },
		);
	}

	getMigration(input: { repoId?: string; migrationId: string }): Promise<TreeDxMigration> {
		return this.request<Record<string, unknown>>(
			'GET',
			`/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/migrations/${encodeURIComponent(input.migrationId)}`,
			undefined,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxMigration>(payload, ['migration']));
	}

	getNode(): Promise<TreeDxNode> {
		return this.request<Record<string, unknown>>('GET', '/api/v1/node', undefined, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxNode>(payload, ['node']));
	}

	listNodes(): Promise<TreeDxNode[]> {
		return this.request<Record<string, unknown>>('GET', '/api/v1/registry/nodes', undefined, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxNode[]>(payload, ['nodes']));
	}

	getPlacement(repoId: string): Promise<TreeDxRepositoryPlacement> {
		return this.request<Record<string, unknown>>('GET', `/api/v1/registry/repos/${encodeURIComponent(repoId)}/placement`, undefined, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxRepositoryPlacement>(payload, ['placement']));
	}

	getRepository(repoId?: string): Promise<TreeDxRepository> {
		return this.request<Record<string, unknown>>('GET', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}`, undefined, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxRepository>(payload, ['repo']));
	}

	createWorkspace(input: TreeDxCreateWorkspaceRequest): Promise<TreeDxWorkspace> {
		const { repoId, ...body } = input;
		return this.request<TreeDxWorkspace>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/workspaces`, body, { tokenRequired: true });
	}

	async closeWorkspace(workspaceId: string): Promise<void> {
		await this.request<Record<string, unknown>>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/close`, {}, { tokenRequired: true });
	}

	listTree(input: TreeDxListTreeRequest): Promise<TreeDxTreeEntry[]> {
		return this.request<Record<string, unknown>>('GET', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/tree`, undefined, {
			query: { path: input.path ?? '', includeDeleted: input.includeDeleted },
			tokenRequired: true,
		}).then((payload) => firstPayload<TreeDxTreeEntry[]>(payload, ['entries']));
	}

	readFile(input: TreeDxReadFileRequest): Promise<TreeDxFile> {
		return this.request<TreeDxFile>('GET', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/files`, undefined, {
			query: { path: input.path, allowProtected: input.allowProtected },
			tokenRequired: true,
		});
	}

	writeFile(input: TreeDxWriteFileRequest): Promise<TreeDxFileMutationResult> {
		const { workspaceId, path, ...body } = input;
		return this.request<TreeDxFileMutationResult>('PUT', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/files`, body, {
			query: { path },
			tokenRequired: true,
		});
	}

	patchFile(input: TreeDxPatchFileRequest): Promise<TreeDxFileMutationResult> {
		const { workspaceId, path, ...body } = input;
		return this.request<TreeDxFileMutationResult>('PATCH', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/files`, body, {
			query: { path },
			tokenRequired: true,
		});
	}

	deleteFile(input: TreeDxDeleteFileRequest): Promise<TreeDxFileMutationResult> {
		const { workspaceId, path, ...body } = input;
		return this.request<TreeDxFileMutationResult>('DELETE', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/files`, body, {
			query: { path },
			tokenRequired: true,
		});
	}

	readBlob(input: TreeDxBlobReadRequest): Promise<TreeDxBlob> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/blobs/read`, body, {
			tokenRequired: true,
		}).then((payload) => firstPayload<TreeDxBlob>(payload, ['blob']));
	}

	writeBlob(input: TreeDxBlobWriteRequest): Promise<TreeDxBlobMutationResult> {
		const { workspaceId, path, ...body } = input;
		return this.request<Record<string, unknown>>(
			'POST',
			`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/blobs/write`,
			{ path, ...body, encoding: body.encoding ?? 'base64' },
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxBlobMutationResult>(payload, ['result']));
	}

	deleteBlob(input: TreeDxBlobDeleteRequest): Promise<TreeDxBlobMutationResult> {
		const { workspaceId, ...body } = input;
		return this.request<Record<string, unknown>>(
			'POST',
			`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/blobs/delete`,
			body,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxBlobMutationResult>(payload, ['result']));
	}

	downloadBlob(input: TreeDxBlobDownloadRequest): Promise<TreeDxBlobDownload> {
		return this.requestBlobDownload(input);
	}

	uploadBlob(input: TreeDxBlobUploadRequest): Promise<TreeDxBlobMutationResult> {
		return this.requestBlobUpload(input);
	}

	createBlobUpload(input: TreeDxBlobUploadCreateRequest): Promise<TreeDxBlobUploadSession> {
		const { workspaceId, ...body } = input;
		return this.request<Record<string, unknown>>(
			'POST',
			`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/blobs/uploads`,
			body,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxBlobUploadSession>(payload, ['upload']));
	}

	async uploadBlobPart(input: TreeDxBlobUploadPartRequest): Promise<TreeDxBlobUploadPart> {
		if (!this.token) {
			throw new TreeDxApiError('TreeDX bearer token is required.', {
				status: 401,
				code: 'missing_token',
			});
		}
		const response = await this.fetchWithTimeout(
			`${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/blobs/uploads/${encodeURIComponent(input.uploadId)}/parts/${encodeURIComponent(input.partNumber)}`,
			{
				method: 'PUT',
				headers: {
					accept: 'application/json',
					authorization: `Bearer ${this.token}`,
					'content-type': 'application/octet-stream',
				},
				body: input.content,
			},
		);
		const payload = await this.parseJsonResponse(response);
		if (!response.ok || (isRecord(payload) && payload.ok === false)) {
			this.throwApiError(response, payload);
		}
		return firstPayload<TreeDxBlobUploadPart>(payload, ['part']);
	}

	completeBlobUpload(input: TreeDxBlobUploadCompleteRequest): Promise<TreeDxBlobMutationResult> {
		const { workspaceId, uploadId, ...body } = input;
		return this.request<Record<string, unknown>>(
			'POST',
			`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/blobs/uploads/${encodeURIComponent(uploadId)}/complete`,
			body,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxBlobMutationResult>(payload, ['result']));
	}

	abortBlobUpload(input: TreeDxBlobUploadAbortRequest): Promise<TreeDxBlobUploadSession> {
		return this.request<Record<string, unknown>>(
			'DELETE',
			`/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/blobs/uploads/${encodeURIComponent(input.uploadId)}`,
			undefined,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxBlobUploadSession>(payload, ['upload']));
	}

	listArtifacts(input: TreeDxArtifactListRequest = {}): Promise<TreeDxArtifact[]> {
		return this.request<Record<string, unknown>>(
			'GET',
			`/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/artifacts`,
			undefined,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxArtifact[]>(payload, ['artifacts']));
	}

	getArtifact(input: TreeDxArtifactGetRequest): Promise<TreeDxArtifact> {
		return this.request<Record<string, unknown>>(
			'GET',
			`/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/artifacts/${encodeURIComponent(input.artifactId)}`,
			undefined,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxArtifact>(payload, ['artifact']));
	}

	deleteArtifact(input: TreeDxArtifactDeleteRequest): Promise<TreeDxArtifact> {
		return this.request<Record<string, unknown>>(
			'DELETE',
			`/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/artifacts/${encodeURIComponent(input.artifactId)}`,
			undefined,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxArtifact>(payload, ['artifact']));
	}

	cleanupArtifacts(input: TreeDxArtifactCleanupRequest = {}): Promise<TreeDxArtifactCleanupResult> {
		return this.request<Record<string, unknown>>(
			'POST',
			'/api/v1/admin/artifacts/cleanup',
			input,
			{ tokenRequired: true },
		).then((payload) => firstPayload<TreeDxArtifactCleanupResult>(payload, ['cleanup']));
	}

	search(input: TreeDxSearchRequest): Promise<TreeDxSearchResult> {
		const { workspaceId, ...body } = input;
		return this.request<TreeDxSearchResult>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/search`, body, { tokenRequired: true });
	}

	status(input: TreeDxWorkspaceRequest): Promise<TreeDxStatus> {
		return this.request<TreeDxStatus>('GET', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/status`, undefined, { tokenRequired: true });
	}

	diff(input: TreeDxWorkspaceRequest): Promise<TreeDxDiff> {
		return this.request<TreeDxDiff>('GET', `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/diff`, undefined, { tokenRequired: true });
	}

	commit(input: TreeDxCommitRequest): Promise<TreeDxCommitResult> {
		const { workspaceId, ...body } = input;
		return this.request<TreeDxCommitResult>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/commit`, body, { tokenRequired: true });
	}

	exec(input: TreeDxExecRequest): Promise<TreeDxExecResult> {
		const { workspaceId, ...body } = input;
		return this.request<TreeDxExecResult>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/exec`, body, { tokenRequired: true });
	}

	readRepositoryFiles(input: TreeDxRepositoryReadRequest): Promise<TreeDxRepositoryQueryResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDxRepositoryQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/files/read`, body, { tokenRequired: true });
	}

	readRepositoryFile(input: TreeDxRepositoryReadRequest): Promise<TreeDxRepositoryQueryResult> {
		return this.readRepositoryFiles(input);
	}

	listRepositoryPaths(input: TreeDxRepositoryPathsRequest): Promise<TreeDxRepositoryQueryResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDxRepositoryQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/paths/list`, body, { tokenRequired: true });
	}

	searchRepositoryFiles(input: TreeDxRepositorySearchRequest): Promise<TreeDxRepositoryQueryResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDxRepositoryQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/files/search`, body, { tokenRequired: true });
	}

	queryRepository(input: TreeDxRepositoryQueryRequest): Promise<TreeDxRepositoryQueryResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDxRepositoryQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/query`, body, { tokenRequired: true });
	}

	federatedSearch(input: TreeDxFederatedSearchRequest): Promise<TreeDxFederatedSearchResult> {
		return this.request<Record<string, unknown>>('POST', '/api/v1/search', input, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxFederatedSearchResult>(payload, ['search']));
	}

	federatedQuery(input: TreeDxFederatedQueryRequest): Promise<TreeDxFederatedQueryResult> {
		return this.request<Record<string, unknown>>('POST', '/api/v1/query', input, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxFederatedQueryResult>(payload, ['query']));
	}

	federatedContext(input: TreeDxFederatedContextRequest): Promise<TreeDxFederatedContextResult> {
		return this.request<Record<string, unknown>>('POST', '/api/v1/context/build', input, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxFederatedContextResult>(payload, ['context']));
	}

	federatedGraph(input: TreeDxFederatedGraphRequest): Promise<TreeDxFederatedGraphResult> {
		return this.request<Record<string, unknown>>('POST', '/api/v1/graph/query', input, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxFederatedGraphResult>(payload, ['graph']));
	}

	refreshGraph(input: TreeDxGraphRefreshRequest = {}): Promise<TreeDxGraphRefreshResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDxGraphRefreshResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/graph/refresh`, body, { tokenRequired: true });
	}

	getGraphRefreshJob(input: TreeDxGraphRefreshJobRequest): Promise<TreeDxGraphRefreshJob> {
		return this.request<Record<string, unknown>>(
			'GET',
			`/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/graph/refresh-jobs/${encodeURIComponent(input.jobId)}`,
			undefined,
			{ query: { ref: input.ref }, tokenRequired: true },
		).then((payload) => firstPayload<TreeDxGraphRefreshJob>(payload, ['job']));
	}

	refreshSearchIndex(input: TreeDxSearchIndexRefreshRequest = {}): Promise<TreeDxSearchIndexRefreshResult> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/search/index/refresh`, body, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxSearchIndexRefreshResult>(payload, ['index']));
	}

	getSearchIndexStatus(input: TreeDxSearchIndexStatusRequest = {}): Promise<TreeDxSearchIndexStatus> {
		return this.request<Record<string, unknown>>(
			'GET',
			`/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/search/index/status`,
			undefined,
			{ query: { ref: input.ref }, tokenRequired: true },
		).then((payload) => firstPayload<TreeDxSearchIndexStatus>(payload, ['index']));
	}

	compactSearchIndex(input: TreeDxSearchIndexCompactRequest = {}): Promise<TreeDxSearchIndexCompactResult> {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/search/index/compact`, body, { tokenRequired: true })
			.then((payload) => firstPayload<TreeDxSearchIndexCompactResult>(payload, ['compact']));
	}

	queryGraph(input: TreeDxGraphQueryRequest): Promise<TreeDxGraphQueryResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDxGraphQueryResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/graph/query`, body, { tokenRequired: true });
	}

	searchGraphFiles(input: TreeDxGraphSearchRequest): Promise<SdkGraphSearchResult[]> {
		return this.graphSearch('/graph/search-files', input);
	}

	searchGraphSections(input: TreeDxGraphSearchRequest): Promise<SdkGraphSearchResult[]> {
		return this.graphSearch('/graph/search-sections', input);
	}

	searchGraphEntities(input: TreeDxGraphSearchRequest): Promise<SdkGraphSearchResult[]> {
		return this.graphSearch('/graph/search-entities', input);
	}

	getGraphNode(input: TreeDxGraphNodeRequest) {
		return this.request<Record<string, unknown>>('GET', `/api/v1/repos/${encodeURIComponent(this.repoId(input.repoId))}/graph/nodes/${encodeURIComponent(input.nodeId)}`, undefined, {
			query: { ref: input.ref },
			tokenRequired: true,
		}).then((payload) => firstPayload(payload, ['node']));
	}

	getRelated(input: TreeDxGraphRelatedRequest) {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/graph/related`, body, { tokenRequired: true });
	}

	getSubgraph(input: TreeDxGraphSubgraphRequest) {
		const { repoId, ...body } = input;
		return this.request<Record<string, unknown>>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/graph/subgraph`, body, { tokenRequired: true });
	}

	buildContext(input: TreeDxContextRequest): Promise<TreeDxContextResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDxContextResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/context/build`, body, { tokenRequired: true });
	}

	parseContextDsl(input: TreeDxCtxParseRequest): Promise<TreeDxCtxParseResult> {
		const { repoId, ...body } = input;
		return this.request<TreeDxCtxParseResult>('POST', `/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/context/parse-ctx`, body, { tokenRequired: true });
	}

	private graphSearch(path: string, input: TreeDxGraphSearchRequest): Promise<SdkGraphSearchResult[]> {
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
