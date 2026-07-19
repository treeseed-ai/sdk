import {
	TREESEED_REMOTE_CONTRACT_HEADER,
	TREESEED_REMOTE_CONTRACT_VERSION,
} from '../remote.ts';
import type {
	ProviderAssignmentLifecycleRequest,
	ProviderAssignmentLifecycleResult,
	ProviderNextAssignmentRequest,
} from '../agent-capacity.ts';
import type {
	CapacityProviderIdentity,
	CapacityProviderIdentityRotationRequest,
	CapacityProviderSignedProof,
	ProviderAccessTokenIssue,
	ProviderCredentialIssuanceAuthorization,
	ProviderAvailabilitySession,
	ProviderRegistrationRequest,
	ProviderRegistrationSubmission,
	ProviderTeamCredentialIssue,
} from './contracts/index.ts';
import {
	CAPACITY_PROVIDER_ENDPOINTS,
	CAPACITY_PROVIDER_GOVERNANCE_ENDPOINTS,
} from './protocol.ts';
import {
	assertCapacityProviderOkEnvelope,
	buildCapacityProviderAuthHeaders,
} from './security/http.ts';

export interface ProviderProtocolClientOptions {
	marketUrl: string;
	accessToken?: string;
	fetchImpl?: typeof fetch;
	userAgent?: string;
	requestTimeoutMs?: number;
}

export class CapacityProviderApiError extends Error {
	readonly code: string;
	readonly details?: unknown;

	constructor(message: string, readonly status: number, readonly payload: unknown) {
		super(message);
		this.name = 'CapacityProviderApiError';
		this.code = isRecord(payload) && typeof payload.code === 'string'
			? payload.code
			: 'capacity_provider_request_failed';
		this.details = isRecord(payload) ? payload.details : undefined;
	}
}

function normalizeBaseUrl(value: string) {
	const trimmed = value.trim().replace(/\/+$/u, '');
	if (!trimmed) throw new Error('Capacity provider Market URL is required.');
	return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, label: string) {
	const value = record[key];
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is missing required string field "${key}".`);
	return value;
}

function requireNumber(record: Record<string, unknown>, key: string, label: string) {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is missing required numeric field "${key}".`);
	return value;
}

function assertAvailabilitySessionEnvelope(value: unknown): asserts value is { ok: true; payload: ProviderAvailabilitySession } {
	assertCapacityProviderOkEnvelope(value, 'Capacity provider availability session response');
	const envelope = value as Record<string, unknown>;
	if (!isRecord(envelope.payload)) throw new Error('Capacity provider availability session response is missing payload.');
	requireString(envelope.payload, 'id', 'Capacity provider availability session');
	requireString(envelope.payload, 'membershipId', 'Capacity provider availability session');
	requireString(envelope.payload, 'teamId', 'Capacity provider availability session');
	requireString(envelope.payload, 'providerId', 'Capacity provider availability session');
	requireString(envelope.payload, 'status', 'Capacity provider availability session');
	requireNumber(envelope.payload, 'sequence', 'Capacity provider availability session');
}

export class ProviderProtocolClient {
	private readonly marketUrl: string;
	private accessToken?: string;
	private readonly fetchImpl: typeof fetch;
	private readonly userAgent?: string;
	private readonly requestTimeoutMs: number;

	constructor(options: ProviderProtocolClientOptions) {
		this.marketUrl = normalizeBaseUrl(options.marketUrl);
		this.accessToken = options.accessToken?.trim() || undefined;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.userAgent = options.userAgent;
		this.requestTimeoutMs = Math.max(1_000, Number(options.requestTimeoutMs ?? 30_000) || 30_000);
	}

	private async requestJson<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string>; authorization?: string | null } = {}): Promise<T> {
		const authorization = options.authorization === undefined
			? buildCapacityProviderAuthHeaders(this.accessToken ?? '').authorization
			: options.authorization;
		const headers: Record<string, string> = {
			accept: 'application/json',
			[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
			...(authorization ? { authorization } : {}),
			...options.headers,
		};
		if (this.userAgent) headers['user-agent'] = this.userAgent;
		if (options.body !== undefined) headers['content-type'] = 'application/json';
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
		let response: Response;
		let payload: unknown;
		try {
			response = await this.fetchImpl(`${this.marketUrl}${path}`, {
				method: options.method ?? 'GET',
				headers,
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
				signal: controller.signal,
			});
			payload = await response.json().catch((error) => {
				if (controller.signal.aborted) throw error;
				return {};
			});
		} catch (error) {
			const message = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
				? `Capacity provider request timed out after ${this.requestTimeoutMs}ms: ${path}`
				: error instanceof Error ? error.message : String(error);
			throw new CapacityProviderApiError(message, 0, { path, timeoutMs: this.requestTimeoutMs });
		} finally {
			clearTimeout(timeout);
		}
		if (!response.ok) {
			const message = isRecord(payload) && typeof payload.error === 'string'
				? payload.error
				: `Capacity provider request failed with ${response.status}.`;
			throw new CapacityProviderApiError(message, response.status, payload);
		}
		return payload as T;
	}

	private async requestOkJson<T extends { ok: true }>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string>; authorization?: string | null } = {}): Promise<T> {
		const response = await this.requestJson<T>(path, options);
		assertCapacityProviderOkEnvelope(response);
		return response;
	}

	private async requestPayload<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string>; authorization?: string | null }): Promise<T> {
		const response = await this.requestJson<unknown>(path, options);
		if (isRecord(response) && 'payload' in response) return response.payload as T;
		return response as T;
	}

	register(registrationKey: string, submission: ProviderRegistrationSubmission, idempotencyKey: string) {
		const key = registrationKey.trim();
		if (!key) throw new Error('Team capacity registration key is required.');
		return this.requestPayload<ProviderRegistrationRequest>(CAPACITY_PROVIDER_GOVERNANCE_ENDPOINTS.registrations, {
			method: 'POST', authorization: `Treeseed-Registration ${key}`,
			headers: { 'idempotency-key': idempotencyKey }, body: submission,
		});
	}

	registrationStatus(requestId: string, proof: CapacityProviderSignedProof) {
		return this.requestPayload<ProviderRegistrationRequest>(CAPACITY_PROVIDER_GOVERNANCE_ENDPOINTS.registration(requestId), {
			authorization: null,
			headers: { 'x-treeseed-provider-proof': Buffer.from(JSON.stringify(proof)).toString('base64url') },
		});
	}

	exchangeCredential(requestId: string, proof: CapacityProviderSignedProof, idempotencyKey: string) {
		return this.requestPayload<ProviderTeamCredentialIssue>(CAPACITY_PROVIDER_GOVERNANCE_ENDPOINTS.registrationCredential(requestId), {
			method: 'POST', authorization: null,
			headers: { 'idempotency-key': idempotencyKey }, body: { proof },
		});
	}

	issueAccessToken(credential: string, credentialId: string, proof: CapacityProviderSignedProof, idempotencyKey: string) {
		const value = credential.trim();
		if (!value) throw new Error('Provider team credential is required.');
		return this.requestPayload<ProviderAccessTokenIssue>(CAPACITY_PROVIDER_GOVERNANCE_ENDPOINTS.accessTokens, {
			method: 'POST', authorization: `Treeseed-Credential ${value}`,
			headers: { 'idempotency-key': idempotencyKey }, body: { credentialId, proof },
		});
	}

	leaveMembership(accessToken: string, idempotencyKey: string) {
		return this.requestPayload<Record<string, unknown>>(CAPACITY_PROVIDER_GOVERNANCE_ENDPOINTS.membershipLeave, {
			method: 'POST', authorization: buildCapacityProviderAuthHeaders(accessToken).authorization,
			headers: { 'idempotency-key': idempotencyKey }, body: {},
		});
	}

	authorizeCredentialRotation(accessToken: string, idempotencyKey: string) {
		return this.requestPayload<ProviderCredentialIssuanceAuthorization>(CAPACITY_PROVIDER_GOVERNANCE_ENDPOINTS.credentialRotation, {
			method: 'POST', authorization: buildCapacityProviderAuthHeaders(accessToken).authorization,
			headers: { 'idempotency-key': idempotencyKey }, body: {},
		});
	}

	rotateIdentity(accessToken: string, request: CapacityProviderIdentityRotationRequest, idempotencyKey: string) {
		return this.requestPayload<CapacityProviderIdentity>(CAPACITY_PROVIDER_GOVERNANCE_ENDPOINTS.identityRotate, {
			method: 'POST', authorization: buildCapacityProviderAuthHeaders(accessToken).authorization,
			headers: { 'idempotency-key': idempotencyKey }, body: request,
		});
	}

	createAvailabilitySession(request: Record<string, unknown> = {}) {
		return this.requestOkJson<{ ok: true; payload: ProviderAvailabilitySession }>(CAPACITY_PROVIDER_ENDPOINTS.sessions, { method: 'POST', body: request }).then((response) => {
			assertAvailabilitySessionEnvelope(response);
			return response;
		});
	}

	refreshAvailabilitySession(sessionId: string, request: Record<string, unknown> = {}) {
		return this.requestOkJson<{ ok: true; payload: ProviderAvailabilitySession }>(CAPACITY_PROVIDER_ENDPOINTS.sessionRefresh(sessionId), { method: 'PUT', body: request }).then((response) => {
			assertAvailabilitySessionEnvelope(response);
			return response;
		});
	}

	closeAvailabilitySession(sessionId: string) {
		return this.requestOkJson<{ ok: true; payload: ProviderAvailabilitySession }>(CAPACITY_PROVIDER_ENDPOINTS.sessionClose(sessionId), { method: 'POST', body: {} }).then((response) => {
			assertAvailabilitySessionEnvelope(response);
			return response;
		});
	}

	assignment(assignmentId: string) {
		return this.requestOkJson<{ ok: true; payload: Record<string, unknown> }>(CAPACITY_PROVIDER_ENDPOINTS.assignment(assignmentId));
	}

	assignmentExplanation(assignmentId: string) {
		return this.requestOkJson<{ ok: true; payload: Record<string, unknown> }>(CAPACITY_PROVIDER_ENDPOINTS.assignmentExplanation(assignmentId));
	}

	nextAssignment(request: ProviderNextAssignmentRequest = {}) {
		return this.requestOkJson<ProviderAssignmentLifecycleResult>(CAPACITY_PROVIDER_ENDPOINTS.nextAssignment, { method: 'POST', body: request });
	}

	renewAssignment(assignmentId: string, request: ProviderAssignmentLifecycleRequest = {}) {
		return this.requestOkJson<ProviderAssignmentLifecycleResult>(CAPACITY_PROVIDER_ENDPOINTS.assignmentRenew(assignmentId), { method: 'POST', body: request });
	}

	returnAssignment(assignmentId: string, request: ProviderAssignmentLifecycleRequest = {}) {
		return this.requestOkJson<ProviderAssignmentLifecycleResult>(CAPACITY_PROVIDER_ENDPOINTS.assignmentReturn(assignmentId), { method: 'POST', body: request });
	}

	completeAssignment(assignmentId: string, request: ProviderAssignmentLifecycleRequest = {}) {
		return this.requestOkJson<ProviderAssignmentLifecycleResult>(CAPACITY_PROVIDER_ENDPOINTS.assignmentComplete(assignmentId), { method: 'POST', body: request });
	}

	failAssignment(assignmentId: string, request: ProviderAssignmentLifecycleRequest = {}) {
		return this.requestOkJson<ProviderAssignmentLifecycleResult>(CAPACITY_PROVIDER_ENDPOINTS.assignmentFail(assignmentId), { method: 'POST', body: request });
	}

	reportAssignmentUsage(assignmentId: string, request: Record<string, unknown>, idempotencyKey: string) {
		return this.requestOkJson<{ ok: true; payload: Record<string, unknown> }>(CAPACITY_PROVIDER_ENDPOINTS.assignmentUsage(assignmentId), { method: 'POST', body: request, headers: { 'idempotency-key': idempotencyKey } });
	}

	settleAssignment(assignmentId: string, request: Record<string, unknown>, idempotencyKey: string) {
		return this.requestOkJson<{ ok: true; payload: Record<string, unknown> }>(CAPACITY_PROVIDER_ENDPOINTS.assignmentSettle(assignmentId), { method: 'POST', body: request, headers: { 'idempotency-key': idempotencyKey } });
	}

	createAssignmentModeRun(assignmentId: string, request: Record<string, unknown>) {
		return this.requestOkJson<{ ok: true; payload: Record<string, unknown> }>(CAPACITY_PROVIDER_ENDPOINTS.assignmentModeRuns(assignmentId), { method: 'POST', body: request });
	}

	dispatchAssignmentWorkflowOperation(assignmentId: string, operationId: string, request: Record<string, unknown>) {
		return this.requestOkJson<{ ok: true; payload: Record<string, unknown> }>(CAPACITY_PROVIDER_ENDPOINTS.assignmentWorkflowOperationDispatch(assignmentId, operationId), { method: 'POST', body: request });
	}
}
