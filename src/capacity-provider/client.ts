import type { ProviderAssignmentLifecycleRequest, ProviderAssignmentLifecycleResult, ProviderNextAssignmentRequest } from '../capacity/agents/agent-capacity.ts';
import type { ProviderRuntimeEventInput } from '../agent-capacity/contracts/capacity/workdays/workday-records.ts';
import { ControlPlaneClient, ControlPlaneClientError } from '../entrypoints/clients/control-plane-client.ts';
import { CONTROL_PLANE_OPERATIONS, type ControlPlaneOperationBinding } from '../operator-contracts/index.ts';
import type {
	CapacityProviderIdentity,
	CapacityProviderIdentityRotationRequest,
	CapacityProviderSignedProof,
	ProviderAccessTokenIssue,
	ProviderAvailabilitySession,
	ProviderCredentialIssuanceAuthorization,
	ProviderRegistrationRequest,
	ProviderRegistrationSubmission,
	ProviderTeamCredentialIssue,
} from './contracts/index.ts';

export interface ProviderProtocolClientOptions {
	controlPlaneUrl: string;
	accessToken?: string;
	accessTokenProvider?: () => Promise<string>;
	fetchImpl?: typeof fetch;
	userAgent?: string;
	requestTimeoutMs?: number;
}

export class CapacityProviderApiError extends Error {
	readonly code: string;
	constructor(message: string, readonly status: number, readonly payload: unknown) {
		super(message);
		this.name = 'CapacityProviderApiError';
		this.code = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).code === 'string'
			? String((payload as Record<string, unknown>).code) : 'capacity_provider_request_failed';
	}
}

export function normalizeBaseUrl(value: string) {
	const normalized = value.trim().replace(/\/+$/u, '');
	if (!normalized) throw new Error('Capacity provider control-plane URL is required.');
	return normalized;
}

type AnyOperation = ControlPlaneOperationBinding<any, any, any, any>;

export class ProviderProtocolClient {
	private readonly controlPlaneUrl: string;
	private accessToken?: string;
	private readonly accessTokenProvider?: () => Promise<string>;
	private readonly fetchImpl: typeof fetch;
	private readonly userAgent?: string;
	private readonly requestTimeoutMs: number;

	constructor(options: ProviderProtocolClientOptions) {
		this.controlPlaneUrl = normalizeBaseUrl(options.controlPlaneUrl);
		this.accessToken = options.accessToken?.trim() || undefined;
		this.accessTokenProvider = options.accessTokenProvider;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.userAgent = options.userAgent;
		this.requestTimeoutMs = Math.max(1_000, Number(options.requestTimeoutMs ?? 30_000) || 30_000);
	}

	private async bearer(required = true) {
		const resolved = this.accessTokenProvider ? (await this.accessTokenProvider()).trim() : this.accessToken ?? '';
		if (resolved) this.accessToken = resolved;
		if (required && !resolved) throw new Error('Capacity provider membership access token is required.');
		return resolved ? `Bearer ${resolved}` : null;
	}

	private async invoke<T>(
		operation: AnyOperation,
		input: { path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown },
		options: { authorization?: string | null; headers?: Record<string, string>; idempotencyKey?: string; requireBearer?: boolean } = {},
	): Promise<T> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
		try {
			const authorization = options.authorization === undefined ? await this.bearer(options.requireBearer ?? true) : options.authorization;
			const client = new ControlPlaneClient({
				profile: { serverId: 'provider-control-plane', label: 'Provider control plane', baseUrl: this.controlPlaneUrl },
				fetchImpl: this.fetchImpl, userAgent: this.userAgent,
			});
			const idempotencyKey = options.idempotencyKey
				?? (operation.descriptor.idempotency.required ? globalThis.crypto.randomUUID() : undefined);
			const response = await client.invoke(operation, {
				path: input.path ?? {}, query: input.query ?? {}, body: input.body,
			}, { authorization, headers: options.headers, idempotencyKey, signal: controller.signal });
			return response.data as T;
		} catch (error) {
			if (error instanceof CapacityProviderApiError) throw error;
			if (error instanceof ControlPlaneClientError) throw new CapacityProviderApiError(error.message, error.status, error.problem);
			const timedOut = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
			throw new CapacityProviderApiError(
				timedOut ? `Capacity provider request timed out after ${this.requestTimeoutMs}ms.` : error instanceof Error ? error.message : String(error),
				0, { timeoutMs: this.requestTimeoutMs },
			);
		} finally {
			clearTimeout(timeout);
		}
	}

	register(registrationKey: string, submission: ProviderRegistrationSubmission, idempotencyKey: string) {
		const key = registrationKey.trim();
		if (!key) throw new Error('Team capacity registration key is required.');
		return this.invoke<ProviderRegistrationRequest>(CONTROL_PLANE_OPERATIONS.providers.register, { body: submission }, { authorization: `Treeseed-Registration ${key}`, idempotencyKey });
	}

	registrationStatus(requestId: string, proof: CapacityProviderSignedProof) {
		return this.invoke<ProviderRegistrationRequest>(CONTROL_PLANE_OPERATIONS.providers.registration, { path: { requestId } }, {
			authorization: null, headers: { 'x-treeseed-provider-proof': Buffer.from(JSON.stringify(proof)).toString('base64url') },
		});
	}

	exchangeCredential(requestId: string, proof: CapacityProviderSignedProof, idempotencyKey: string) {
		return this.invoke<ProviderTeamCredentialIssue>(CONTROL_PLANE_OPERATIONS.providers.exchangeCredential, { path: { requestId }, body: { proof } }, { authorization: null, idempotencyKey });
	}

	issueAccessToken(credential: string, credentialId: string, proof: CapacityProviderSignedProof, idempotencyKey: string, requestedValiditySeconds?: number) {
		const value = credential.trim();
		if (!value) throw new Error('Provider team credential is required.');
		return this.invoke<ProviderAccessTokenIssue>(CONTROL_PLANE_OPERATIONS.providers.issueAccessToken, { body: { credentialId, requestedValiditySeconds, proof } }, { authorization: `Treeseed-Credential ${value}`, idempotencyKey });
	}

	leaveMembership(accessToken: string, idempotencyKey: string) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.leaveMembership, { body: {} }, { authorization: `Bearer ${accessToken}`, idempotencyKey });
	}

	authorizeCredentialRotation(accessToken: string, idempotencyKey: string) {
		return this.invoke<ProviderCredentialIssuanceAuthorization>(CONTROL_PLANE_OPERATIONS.providers.rotateCredential, { body: {} }, { authorization: `Bearer ${accessToken}`, idempotencyKey });
	}

	rotateIdentity(accessToken: string, request: CapacityProviderIdentityRotationRequest, idempotencyKey: string) {
		return this.invoke<CapacityProviderIdentity>(CONTROL_PLANE_OPERATIONS.providers.rotateIdentity, { body: request }, { authorization: `Bearer ${accessToken}`, idempotencyKey });
	}

	createAvailabilitySession(request: Record<string, unknown> = {}) {
		return this.invoke<ProviderAvailabilitySession>(CONTROL_PLANE_OPERATIONS.providers.createAvailability, { body: request });
	}

	refreshAvailabilitySession(sessionId: string, request: Record<string, unknown> = {}) {
		return this.invoke<ProviderAvailabilitySession>(CONTROL_PLANE_OPERATIONS.providers.refreshAvailability, { path: { sessionId }, body: request });
	}

	closeAvailabilitySession(sessionId: string) {
		return this.invoke<ProviderAvailabilitySession>(CONTROL_PLANE_OPERATIONS.providers.closeAvailability, { path: { sessionId }, body: {} });
	}

	assignment(assignmentId: string) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.assignment, { path: { assignmentId } });
	}

	assignmentExplanation(assignmentId: string) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.assignmentExplanation, { path: { assignmentId } });
	}

	nextAssignment(request: ProviderNextAssignmentRequest = {}) {
		return this.invoke<ProviderAssignmentLifecycleResult>(CONTROL_PLANE_OPERATIONS.providers.nextAssignment, { body: request });
	}

	renewAssignment(assignmentId: string, request: ProviderAssignmentLifecycleRequest = {}) {
		return this.invoke<ProviderAssignmentLifecycleResult>(CONTROL_PLANE_OPERATIONS.providers.renewAssignment, { path: { assignmentId }, body: request });
	}

	startAssignmentExecution(assignmentId: string, request: Record<string, unknown>) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.startExecution, { path: { assignmentId }, body: request });
	}

	startAssignmentCloseout(assignmentId: string, request: Record<string, unknown>) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.startCloseout, { path: { assignmentId }, body: request });
	}

	preflightAssignmentCompletion(assignmentId: string, request: Record<string, unknown>) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.completionPreflight, { path: { assignmentId }, body: request });
	}

	returnAssignment(assignmentId: string, request: ProviderAssignmentLifecycleRequest = {}) {
		return this.invoke<ProviderAssignmentLifecycleResult>(CONTROL_PLANE_OPERATIONS.providers.returnAssignment, { path: { assignmentId }, body: request });
	}

	completeAssignment(assignmentId: string, request: ProviderAssignmentLifecycleRequest = {}) {
		return this.invoke<ProviderAssignmentLifecycleResult>(CONTROL_PLANE_OPERATIONS.providers.completeAssignment, { path: { assignmentId }, body: request });
	}

	failAssignment(assignmentId: string, request: ProviderAssignmentLifecycleRequest = {}) {
		return this.invoke<ProviderAssignmentLifecycleResult>(CONTROL_PLANE_OPERATIONS.providers.failAssignment, { path: { assignmentId }, body: request });
	}

	reportAssignmentUsage(assignmentId: string, request: Record<string, unknown>, idempotencyKey: string) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.reportUsage, { path: { assignmentId }, body: request }, { idempotencyKey });
	}

	settleAssignment(assignmentId: string, request: Record<string, unknown>, idempotencyKey: string) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.settleAssignment, { path: { assignmentId }, body: request }, { idempotencyKey });
	}

	createAssignmentModeRun(assignmentId: string, request: Record<string, unknown>) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.createModeRun, { path: { assignmentId }, body: request });
	}

	createAssignmentEvent(assignmentId: string, request: ProviderRuntimeEventInput) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.createEvent, { path: { assignmentId }, body: request });
	}

	publishAssignmentSignal(assignmentId: string, request: Record<string, unknown>) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.publishSignal, { path: { assignmentId }, body: request });
	}

	dispatchAssignmentWorkflowOperation(assignmentId: string, operationId: string, request: Record<string, unknown>) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.dispatchWorkflow, { path: { assignmentId, operationId }, body: request });
	}

	getAssignmentWorkflowRun(assignmentId: string, runId: string) {
		return this.invoke<Record<string, unknown>>(CONTROL_PLANE_OPERATIONS.providers.workflowRun, { path: { assignmentId, runId } });
	}
}
