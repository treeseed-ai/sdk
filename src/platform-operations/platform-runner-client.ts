import {
	REMOTE_CONTRACT_HEADER,
	REMOTE_CONTRACT_VERSION,
} from '../entrypoints/clients/remote.ts';
import { PLATFORM_OPERATION_ENDPOINTS, PlatformOperation, PlatformOperationEvent, PlatformRunnerClaimRequest, PlatformRunnerClientOptions, PlatformRunnerHeartbeatRequest, PlatformRunnerJobUpdateRequest, PlatformRunnerRegistrationRequest, buildPlatformRunnerAuthHeaders } from './platform-operation-endpoints.ts';
import { PlatformOperationApiError, assertPlatformOperation, assertPlatformOperationEvent, assertPlatformOperationOkEnvelope, isRecord, normalizeBaseUrl } from './nested-record.ts';

export class PlatformRunnerClient {
	private readonly marketUrl: string;
	private readonly marketId: string;
	private readonly runnerSecret: string;
	private readonly fetchImpl: typeof fetch;
	private readonly userAgent?: string;

	constructor(options: PlatformRunnerClientOptions) {
		this.marketUrl = normalizeBaseUrl(options.marketUrl);
		this.marketId = options.marketId.trim();
		this.runnerSecret = options.runnerSecret.trim();
		if (!this.marketUrl) throw new Error('API URL is required.');
		if (!this.marketId) throw new Error('Market ID is required.');
		if (!this.runnerSecret) throw new Error('Platform runner secret is required.');
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.userAgent = options.userAgent;
	}

	private async requestJson<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
		const headers: Record<string, string> = {
			accept: 'application/json',
			[REMOTE_CONTRACT_HEADER]: String(REMOTE_CONTRACT_VERSION),
			...buildPlatformRunnerAuthHeaders(this.runnerSecret),
		};
		if (this.userAgent) headers['user-agent'] = this.userAgent;
		if (options.body !== undefined) headers['content-type'] = 'application/json';
		const response = await this.fetchImpl(`${this.marketUrl}${path}`, {
			method: options.method ?? 'GET',
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			const message = isRecord(payload) && typeof payload.error === 'string'
				? payload.error
				: `Platform operation request failed with ${response.status}.`;
			throw new PlatformOperationApiError(message, response.status, payload);
		}
		return payload as T;
	}

	register(request: PlatformRunnerRegistrationRequest) {
		return this.requestJson<{ ok: true; runner: Record<string, unknown> }>(PLATFORM_OPERATION_ENDPOINTS.registerRunner, {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform runner registration response');
			return response;
		});
	}

	heartbeat(request: PlatformRunnerHeartbeatRequest) {
		return this.requestJson<{ ok: true; runner: Record<string, unknown> }>(PLATFORM_OPERATION_ENDPOINTS.heartbeatRunner, {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform runner heartbeat response');
			return response;
		});
	}

	claimJob(request: PlatformRunnerClaimRequest) {
		return this.requestJson<{ ok: true; operation: PlatformOperation | null }>(PLATFORM_OPERATION_ENDPOINTS.claimJob, {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform runner claim response');
			if (response.operation !== null) assertPlatformOperation(response.operation, 'Claimed platform operation');
			return response;
		});
	}

	getOperation(operationId: string) {
		return this.requestJson<{ ok: true; operation: PlatformOperation }>(PLATFORM_OPERATION_ENDPOINTS.runnerJob(operationId), {
			method: 'GET',
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation response');
			assertPlatformOperation(response.operation);
			return response;
		});
	}

	appendEvent(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		return this.requestJson<{ ok: true; event: PlatformOperationEvent }>(PLATFORM_OPERATION_ENDPOINTS.jobEvents(operationId), {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation event response');
			assertPlatformOperationEvent(response.event);
			return response;
		});
	}

	renewLease(operationId: string, request: PlatformRunnerJobUpdateRequest & { leaseSeconds?: number }) {
		return this.requestJson<{ ok: true; operation: PlatformOperation }>(PLATFORM_OPERATION_ENDPOINTS.renewLeaseJob(operationId), {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation lease renewal response');
			assertPlatformOperation(response.operation);
			return response;
		});
	}

	checkpoint(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		return this.requestJson<{ ok: true; operation: PlatformOperation }>(PLATFORM_OPERATION_ENDPOINTS.checkpointJob(operationId), {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation checkpoint response');
			assertPlatformOperation(response.operation);
			return response;
		});
	}

	complete(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		return this.requestJson<{ ok: true; operation: PlatformOperation }>(PLATFORM_OPERATION_ENDPOINTS.completeJob(operationId), {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation completion response');
			assertPlatformOperation(response.operation);
			return response;
		});
	}

	fail(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		return this.requestJson<{ ok: true; operation: PlatformOperation }>(PLATFORM_OPERATION_ENDPOINTS.failJob(operationId), {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation failure response');
			assertPlatformOperation(response.operation);
			return response;
		});
	}

	cancel(operationId: string, request: PlatformRunnerJobUpdateRequest) {
		return this.requestJson<{ ok: true; operation: PlatformOperation }>(`${PLATFORM_OPERATION_ENDPOINTS.runnerJob(operationId)}/cancel`, {
			method: 'POST',
			body: { ...request, marketId: this.marketId },
		}).then((response) => {
			assertPlatformOperationOkEnvelope(response, 'Platform operation cancellation response');
			assertPlatformOperation(response.operation);
			return response;
		});
	}
}
