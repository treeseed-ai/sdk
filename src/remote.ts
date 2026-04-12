export const TREESEED_REMOTE_CONTRACT_VERSION = 1;
export const TREESEED_REMOTE_CONTRACT_HEADER = 'x-treeseed-remote-contract-version';

export type ApiScope = string;

export interface ApiPrincipal {
	id: string;
	displayName?: string;
	scopes: ApiScope[];
	roles: string[];
	permissions: string[];
	metadata?: Record<string, unknown>;
}

export interface RemoteTreeseedHost {
	id: string;
	baseUrl: string;
	label?: string;
	official?: boolean;
	priority?: number;
}

export interface RemoteTreeseedPoolOptions {
	strategy?: 'active-first' | 'priority';
	maxAttempts?: number;
}

export interface RemoteTreeseedConfig {
	hosts: RemoteTreeseedHost[];
	activeHostId: string;
	executionMode?: 'prefer-local' | 'prefer-remote' | 'remote-only';
	auth?: {
		accessToken?: string;
		refreshToken?: string;
		expiresAt?: string;
		principal?: ApiPrincipal | null;
	};
	pool?: RemoteTreeseedPoolOptions;
}

export interface DeviceCodeStartRequest {
	clientName?: string;
	scopes?: ApiScope[];
}

export interface DeviceCodeStartResponse {
	ok: true;
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	intervalSeconds: number;
	expiresAt: string;
	expiresInSeconds: number;
}

export type DeviceCodePollResponse =
	| {
			ok: true;
			status: 'pending';
			intervalSeconds: number;
	  }
	| {
			ok: true;
			status: 'approved';
			accessToken: string;
			refreshToken: string;
			tokenType: 'Bearer';
			expiresAt: string;
			expiresInSeconds: number;
			principal: ApiPrincipal;
	  }
	| {
			ok: false;
			status: 'expired' | 'invalid' | 'already_used';
			error: string;
	  };

export interface DeviceCodePollRequest {
	deviceCode: string;
}

export interface DeviceCodeApproveRequest {
	userCode: string;
	principalId: string;
	displayName?: string;
	scopes?: ApiScope[];
	metadata?: Record<string, unknown>;
}

export interface TokenRefreshRequest {
	refreshToken: string;
}

export interface TokenRefreshResponse {
	ok: true;
	accessToken: string;
	refreshToken: string;
	tokenType: 'Bearer';
	expiresAt: string;
	expiresInSeconds: number;
	principal: ApiPrincipal;
}

export interface RemoteSdkOperationRequest {
	input?: Record<string, unknown>;
	repoRoot?: string;
}

export type RemoteSdkOperationResponse<T = unknown> = T;

export interface RemoteGatewayRequest {
	method?: 'GET' | 'POST';
	body?: unknown;
}

export interface RemoteWorkflowOperationRequest {
	input?: Record<string, unknown>;
	cwd?: string;
	env?: Record<string, string>;
}

export interface RemoteWorkflowNextStep {
	operation: string;
	reason?: string;
	input?: Record<string, unknown>;
}

export interface RemoteWorkflowOperationResponse {
	ok: boolean;
	operation: string;
	payload?: Record<string, unknown> | null;
	nextSteps?: RemoteWorkflowNextStep[];
}

function normalizeBaseUrl(baseUrl: string) {
	return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function resolveActiveHost(config: RemoteTreeseedConfig): RemoteTreeseedHost {
	const host = config.hosts.find((entry) => entry.id === config.activeHostId) ?? config.hosts[0];
	if (!host) {
		throw new Error('Remote Treeseed configuration is missing a usable host.');
	}
	return {
		...host,
		baseUrl: normalizeBaseUrl(host.baseUrl),
	};
}

export class RemoteTreeseedClient {
	readonly config: RemoteTreeseedConfig;
	private readonly fetchImpl: typeof fetch;

	constructor(config: RemoteTreeseedConfig, options: { fetchImpl?: typeof fetch } = {}) {
		this.config = config;
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	activeHost() {
		return resolveActiveHost(this.config);
	}

	async requestJson<T>(
		path: string,
		options: {
			method?: 'GET' | 'POST';
			body?: unknown;
			headers?: Record<string, string>;
			requireAuth?: boolean;
		} = {},
	): Promise<T> {
		const host = this.activeHost();
		const headers: Record<string, string> = {
			accept: 'application/json',
			[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
			...(options.headers ?? {}),
		};
		if (options.body !== undefined) {
			headers['content-type'] = 'application/json';
		}
		if (options.requireAuth && this.config.auth?.accessToken) {
			headers.authorization = `Bearer ${this.config.auth.accessToken}`;
		}

		const response = await this.fetchImpl(`${host.baseUrl}${path}`, {
			method: options.method ?? 'GET',
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});

		const contractVersion = response.headers.get(TREESEED_REMOTE_CONTRACT_HEADER);
		if (contractVersion && Number(contractVersion) !== TREESEED_REMOTE_CONTRACT_VERSION) {
			throw new Error(
				`Remote Treeseed contract mismatch. Client=${TREESEED_REMOTE_CONTRACT_VERSION}, server=${contractVersion}.`,
			);
		}

		const payload = await response.json().catch(() => ({})) as T & { error?: string };
		if (!response.ok) {
			const message = typeof (payload as { error?: unknown }).error === 'string'
				? String((payload as { error?: unknown }).error)
				: `Remote request failed with ${response.status}.`;
			throw new Error(message);
		}
		return payload;
	}
}

export class RemoteTreeseedAuthClient {
	constructor(private readonly client: RemoteTreeseedClient) {}

	startDeviceFlow(request: DeviceCodeStartRequest) {
		return this.client.requestJson<DeviceCodeStartResponse>('/auth/device/start', {
			method: 'POST',
			body: request,
		});
	}

	pollDeviceFlow(request: DeviceCodePollRequest) {
		return this.client.requestJson<DeviceCodePollResponse>('/auth/device/poll', {
			method: 'POST',
			body: request,
		});
	}

	refreshAccessToken(request: TokenRefreshRequest) {
		return this.client.requestJson<TokenRefreshResponse>('/auth/token/refresh', {
			method: 'POST',
			body: request,
		});
	}

	whoAmI() {
		return this.client.requestJson<{ ok: true; payload: ApiPrincipal }>('/auth/me', {
			requireAuth: true,
		});
	}
}

export class RemoteTreeseedSdkClient {
	constructor(private readonly client: RemoteTreeseedClient) {}

	execute<T = unknown>(operation: string, request: RemoteSdkOperationRequest) {
		return this.client.requestJson<RemoteSdkOperationResponse<T>>(`/sdk/${encodeURIComponent(operation)}`, {
			method: 'POST',
			body: request,
			requireAuth: true,
		});
	}
}

function normalizeExternalBaseUrl(baseUrl: string) {
	return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export class TreeseedGatewayClient {
	private readonly baseUrl: string;
	private readonly token: string;
	private readonly fetchImpl: typeof fetch;

	constructor(config: import('./sdk-types.ts').SdkGatewayClientConfig) {
		this.baseUrl = normalizeExternalBaseUrl(config.baseUrl);
		this.token = config.bearerToken;
		this.fetchImpl = config.fetchImpl ?? fetch;
	}

	async requestJson<T>(path: string, options: RemoteGatewayRequest = {}) {
		const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
			method: options.method ?? 'POST',
			headers: {
				accept: 'application/json',
				authorization: `Bearer ${this.token}`,
				...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
			},
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
		const payload = await response.json().catch(() => ({})) as T & { error?: string };
		if (!response.ok) {
			throw new Error(typeof payload.error === 'string' ? payload.error : `Gateway request failed with ${response.status}.`);
		}
		return payload;
	}
}

export class CloudflareQueuePullClient {
	private readonly baseUrl: string;
	private readonly token: string;
	private readonly fetchImpl: typeof fetch;

	constructor(config: import('./sdk-types.ts').SdkQueuePullClientConfig) {
		const apiBaseUrl = config.apiBaseUrl ?? 'https://api.cloudflare.com/client/v4/accounts';
		this.baseUrl = `${normalizeExternalBaseUrl(apiBaseUrl)}/${config.accountId}/queues/${config.queueId}`;
		this.token = config.token;
		this.fetchImpl = config.fetchImpl ?? fetch;
	}

	private async request(path: string, body: unknown) {
		const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
			method: 'POST',
			headers: {
				accept: 'application/json',
				authorization: `Bearer ${this.token}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify(body),
		});
		const payload = await response.json().catch(() => ({})) as {
			success?: boolean;
			errors?: Array<{ message?: string }>;
			result?: unknown;
		};
		if (!response.ok || payload.success === false) {
			throw new Error(payload.errors?.[0]?.message ?? `Queue request failed with ${response.status}.`);
		}
		return payload.result;
	}

	async pull(request: import('./sdk-types.ts').SdkQueuePullRequest = {}) {
		const result = await this.request('/messages/pull', {
			batch_size: request.batchSize ?? 1,
			visibility_timeout_ms: request.visibilityTimeoutMs ?? 120000,
		}) as { messages?: Array<{ lease_id: string; attempts: number; body: string }> };
		const messages = (result.messages ?? []).map((entry) => ({
			leaseId: entry.lease_id,
			attempts: Number(entry.attempts ?? 0),
			rawBody: String(entry.body ?? '{}'),
			body: JSON.parse(String(entry.body ?? '{}')) as import('./sdk-types.ts').SdkQueueMessageEnvelope,
		}));
		return { messages };
	}

	ack(acks: string[]) {
		return this.request('/messages/ack', { acks });
	}

	retry(retries: Array<{ leaseId: string; delaySeconds?: number }>) {
		return this.request('/messages/ack', {
			retries: retries.map((entry) => ({
				lease_id: entry.leaseId,
				delay_secs: entry.delaySeconds ?? 0,
			})),
		});
	}
}

export class RemoteTreeseedOperationsClient {
	constructor(private readonly client: RemoteTreeseedClient) {}

	execute(operation: string, request: RemoteWorkflowOperationRequest) {
		return this.client.requestJson<RemoteWorkflowOperationResponse>(`/operations/${encodeURIComponent(operation)}`, {
			method: 'POST',
			body: request,
			requireAuth: true,
		});
	}
}
