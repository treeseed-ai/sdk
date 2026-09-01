import type {
	ControlPlaneOperationBinding,
	ControlPlaneOperationBody,
	ControlPlaneOperationOutput,
	ControlPlaneOperationPath,
	ControlPlaneOperationQuery,
	OAuthScope,
} from '../../operator-contracts/control-plane-operation.ts';
import type { ApiPrincipal } from '../../operator-contracts/oauth.ts';
import type { InputRequired } from '../../operator-contracts/mcp.ts';
import { controlPlaneOperation } from '../../operator-contracts/control-plane-operations.ts';

export const DEFAULT_CONTROL_PLANE_BASE_URL = 'http://127.0.0.1:3002';
export const CONTROL_PLANE_BASE_URL_ENV = 'TREESEED_API_BASE_URL';

export interface ControlPlaneServerProfile {
	serverId: string;
	label: string;
	baseUrl: string;
}

export interface ControlPlaneServerSession {
	serverId: string;
	audience: string;
	accessToken: string;
	refreshToken?: string;
	expiresAt?: string;
	principal?: ApiPrincipal | null;
	activeTeam?: { id: string; slug: string; name: string } | null;
}

export interface ControlPlaneServerRegistry {
	version: 1;
	activeServerId: string;
	servers: ControlPlaneServerProfile[];
}

export interface OAuthDeviceAuthorizationReceipt {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	expiresIn: number;
	interval: number;
}

export interface OAuthTokenReceipt {
	tokenType: 'Bearer';
	accessToken: string;
	expiresIn: number;
	refreshToken?: string;
	scope: OAuthScope[];
	audience: string;
	principal?: ApiPrincipal | null;
}

export interface ControlPlaneClientOptions {
	profile: ControlPlaneServerProfile;
	accessToken?: string | null;
	fetchImpl?: typeof fetch;
	userAgent?: string;
}

export interface ControlPlaneResponseEnvelope<T> {
	data: T;
	meta?: Record<string, unknown>;
	links?: Record<string, string>;
}

export interface ProblemDetails {
	type: string;
	title: string;
	status: number;
	detail?: string;
	instance?: string;
	code: string;
	requestId?: string;
	traceId?: string;
	fields?: Record<string, string[]>;
	inputRequired?: InputRequired;
}

export interface ControlPlaneCallOptions {
	method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
	path: `/v1/${string}` | '/openapi.json';
	input?: unknown;
	headers?: Record<string, string>;
	idempotencyKey?: string;
	ifMatch?: string;
	authorization?: string | null;
	signal?: AbortSignal;
}

export interface ControlPlaneOperationCallOptions {
	headers?: Record<string, string>;
	idempotencyKey?: string;
	ifMatch?: string;
	authorization?: string | null;
	signal?: AbortSignal;
}

export interface ControlPlaneInvocation<TPath, TQuery, TBody> {
	path: TPath;
	query: TQuery;
	body: TBody;
}

export class ControlPlaneClientError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly problem: ProblemDetails,
		readonly responseHeaders: Headers,
	) {
		super(message);
		this.name = 'ControlPlaneClientError';
	}
}

export function normalizeControlPlaneBaseUrl(value: string) {
	const normalized = value.trim().replace(/\/+$/u, '');
	if (!/^https?:\/\//u.test(normalized)) throw new Error('Control-plane server URLs must use HTTP or HTTPS.');
	return normalized;
}

export function defaultLocalControlPlaneServer(
	env: Record<string, string | undefined> = process.env,
): ControlPlaneServerProfile {
	return {
		serverId: 'local',
		label: 'Local TreeSeed control plane',
		baseUrl: normalizeControlPlaneBaseUrl(env[CONTROL_PLANE_BASE_URL_ENV] ?? DEFAULT_CONTROL_PLANE_BASE_URL),
	};
}

function normalizeServer(profile: ControlPlaneServerProfile): ControlPlaneServerProfile {
	const serverId = profile.serverId.trim();
	if (!serverId) throw new Error('Control-plane server IDs cannot be empty.');
	return { serverId, label: profile.label.trim() || serverId, baseUrl: normalizeControlPlaneBaseUrl(profile.baseUrl) };
}

export function normalizeControlPlaneServerRegistry(state: ControlPlaneServerRegistry) {
	const servers = [...new Map(state.servers.map((entry) => {
		const normalized = normalizeServer(entry);
		return [normalized.serverId, normalized];
	})).values()].sort((left, right) => left.serverId.localeCompare(right.serverId));
	if (servers.length === 0) throw new Error('A control-plane server registry requires at least one server.');
	const activeServerId = servers.some((entry) => entry.serverId === state.activeServerId) ? state.activeServerId : servers[0]!.serverId;
	return { version: 1, activeServerId, servers } satisfies ControlPlaneServerRegistry;
}

export function resolveControlPlaneServer(selector: string | null | undefined, registry: ControlPlaneServerRegistry) {
	const value = selector?.trim();
	if (value && /^https?:\/\//iu.test(value)) {
		return normalizeServer({ serverId: value.replace(/^https?:\/\//iu, '').replace(/[^a-z0-9._-]+/giu, '-'), label: value, baseUrl: value });
	}
	const normalized = normalizeControlPlaneServerRegistry(registry);
	const serverId = value || normalized.activeServerId;
	const profile = normalized.servers.find((entry) => entry.serverId === serverId);
	if (!profile) throw new Error(`Unknown control-plane server "${serverId}".`);
	return profile;
}

async function responsePayload(response: Response): Promise<unknown> {
	const contentType = response.headers.get('content-type') ?? '';
	if (contentType.includes('json')) return response.json();
	const text = await response.text();
	return text.length > 0 ? text : null;
}

function problemFrom(payload: unknown, status: number): ProblemDetails {
	const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
	return {
		type: typeof source.type === 'string' ? source.type : 'about:blank',
		title: typeof source.title === 'string' ? source.title : 'Control-plane request failed',
		status,
		detail: typeof source.detail === 'string' ? source.detail : undefined,
		instance: typeof source.instance === 'string' ? source.instance : undefined,
		code: typeof source.code === 'string' ? source.code : 'control_plane_request_failed',
		requestId: typeof source.requestId === 'string' ? source.requestId : undefined,
		traceId: typeof source.traceId === 'string' ? source.traceId : undefined,
		fields: source.fields && typeof source.fields === 'object' ? source.fields as Record<string, string[]> : undefined,
		inputRequired: source.inputRequired && typeof source.inputRequired === 'object' ? source.inputRequired as InputRequired : undefined,
	};
}

export class ControlPlaneClient {
	readonly baseUrl: string;
	readonly accessToken: string | null;
	readonly fetchImpl: typeof fetch;
	readonly userAgent?: string;

	constructor(readonly options: ControlPlaneClientOptions) {
		this.baseUrl = normalizeControlPlaneBaseUrl(options.profile.baseUrl);
		this.accessToken = options.accessToken ?? null;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.userAgent = options.userAgent;
	}

	async invoke<TOperation extends ControlPlaneOperationBinding<any, any, any, any>>(
		binding: TOperation,
		input: ControlPlaneInvocation<ControlPlaneOperationPath<TOperation>, ControlPlaneOperationQuery<TOperation>, ControlPlaneOperationBody<TOperation>>,
		options: ControlPlaneOperationCallOptions = {},
	): Promise<ControlPlaneResponseEnvelope<ControlPlaneOperationOutput<TOperation>>> {
		if (controlPlaneOperation(binding.descriptor.operationId) !== binding) {
			throw new Error(`Operation ${binding.descriptor.operationId} is not the authoritative catalog binding.`);
		}
		const rest = binding.descriptor.rest;
		if (!rest) throw new Error(`Operation ${binding.descriptor.operationId} has no REST binding.`);
		const pathInput = binding.schema.path.parse(input.path) as Record<string, unknown>;
		const queryInput = binding.schema.query.parse(input.query) as Record<string, unknown>;
		const bodyInput = binding.schema.body.parse(input.body);
		let path = rest.path as string;
		path = path.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_match, name: string) => {
			const value = pathInput[name];
			if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Operation ${binding.descriptor.operationId} requires path parameter ${name}.`);
			return encodeURIComponent(String(value));
		});
		if (path.includes('{')) throw new Error(`Operation ${binding.descriptor.operationId} has unresolved path parameters.`);
		const query = new URLSearchParams();
		for (const [name, value] of Object.entries(queryInput)) {
			if (value === undefined || value === null) continue;
			for (const item of Array.isArray(value) ? value : [value]) query.append(name, String(item));
		}
		const queryString = query.toString();
		const response = await this.request<ControlPlaneOperationOutput<TOperation>>({
			method: rest.method,
			path: `${path}${queryString ? `?${queryString}` : ''}` as `/v1/${string}`,
			input: rest.method === 'GET' ? undefined : bodyInput,
			...options,
		});
		return { ...response, data: binding.schema.output.parse(response.data) };
	}

	async authorizeDevice(clientId: string, scope: OAuthScope[], signal?: AbortSignal): Promise<OAuthDeviceAuthorizationReceipt> {
		const response = await this.fetchImpl(`${this.baseUrl}/oauth/device_authorization`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, scope: scope.join(' ') }), signal });
		const rawPayload = await responsePayload(response);
		const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload as Record<string, unknown> : {};
		if (!response.ok) throw new ControlPlaneClientError(String(payload.error_description ?? payload.error ?? 'Device authorization failed.'), response.status, problemFrom(payload, response.status), response.headers);
		return { deviceCode: String(payload.device_code), userCode: String(payload.user_code), verificationUri: String(payload.verification_uri), verificationUriComplete: typeof payload.verification_uri_complete === 'string' ? payload.verification_uri_complete : undefined, expiresIn: Number(payload.expires_in), interval: Number(payload.interval) };
	}

	async exchangeDeviceCode(clientId: string, deviceCode: string, signal?: AbortSignal) {
		return this.exchangeOAuthToken({ client_id: clientId, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode }, signal);
	}

	async refreshAccessToken(clientId: string, refreshToken: string, signal?: AbortSignal) {
		return this.exchangeOAuthToken({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken }, signal);
	}

	async revokeToken(clientId: string, token: string, signal?: AbortSignal) {
		const response = await this.fetchImpl(`${this.baseUrl}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, token }), signal });
		if (!response.ok) throw new ControlPlaneClientError('Token revocation failed.', response.status, problemFrom(await responsePayload(response), response.status), response.headers);
	}

	private async exchangeOAuthToken(values: Record<string, string>, signal?: AbortSignal): Promise<OAuthTokenReceipt> {
		const response = await this.fetchImpl(`${this.baseUrl}/oauth/token`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values), signal });
		const rawPayload = await responsePayload(response);
		const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload as Record<string, unknown> : {};
		if (!response.ok) {
			const problem = problemFrom(rawPayload, response.status);
			problem.code = typeof payload.error === 'string' ? payload.error : problem.code;
			problem.detail = typeof payload.error_description === 'string' ? payload.error_description : problem.detail;
			throw new ControlPlaneClientError(problem.detail ?? problem.code, response.status, problem, response.headers);
		}
		return { tokenType: 'Bearer', accessToken: String(payload.access_token), refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined, expiresIn: Number(payload.expires_in), scope: String(payload.scope ?? '').split(/\s+/u).filter(Boolean) as OAuthScope[], audience: String(payload.audience ?? this.baseUrl), principal: payload.principal && typeof payload.principal === 'object' ? payload.principal as ApiPrincipal : undefined };
	}

	private async request<T>(options: ControlPlaneCallOptions): Promise<ControlPlaneResponseEnvelope<T>> {
		const headers = new Headers(options.headers);
		headers.set('accept', 'application/json, application/problem+json');
		if (options.authorization !== null) {
			const authorization = options.authorization ?? (this.accessToken ? `Bearer ${this.accessToken}` : null);
			if (authorization) headers.set('authorization', authorization);
		}
		if (this.userAgent) headers.set('user-agent', this.userAgent);
		if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey);
		if (options.ifMatch) headers.set('if-match', options.ifMatch);
		if (options.input !== undefined) headers.set('content-type', 'application/json');

		const response = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
			method: options.method ?? 'GET',
			headers,
			body: options.input === undefined ? undefined : JSON.stringify(options.input),
			signal: options.signal,
		});
		const payload = await responsePayload(response);
		if (!response.ok) {
			const problem = problemFrom(payload, response.status);
			throw new ControlPlaneClientError(problem.detail ?? problem.title, response.status, problem, response.headers);
		}
		if (!payload || typeof payload !== 'object' || !('data' in payload)) {
			throw new ControlPlaneClientError('The control plane returned an invalid success envelope.', 502, {
				type: 'https://treeseed.dev/problems/invalid-upstream-response',
				title: 'Invalid control-plane response',
				status: 502,
				code: 'control_plane_response_invalid',
			}, response.headers);
		}
		return payload as ControlPlaneResponseEnvelope<T>;
	}
}
