import type { ApiPrincipal } from './remote.ts';

export const DEFAULT_CONTROL_PLANE_BASE_URL = 'http://127.0.0.1:3002';
export const CONTROL_PLANE_BASE_URL_ENV = 'TREESEED_API_BASE_URL';

export interface ControlPlaneServerProfile {
	serverId: string;
	label: string;
	baseUrl: string;
}

export interface ControlPlaneServerSession {
	serverId: string;
	accessToken: string;
	refreshToken?: string;
	expiresAt?: string;
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
}

export interface ControlPlaneCallOptions {
	method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
	path: `/v1/${string}` | '/openapi.json';
	input?: unknown;
	headers?: Record<string, string>;
	idempotencyKey?: string;
	ifMatch?: string;
	signal?: AbortSignal;
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

function normalizeBaseUrl(value: string) {
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
		baseUrl: normalizeBaseUrl(env[CONTROL_PLANE_BASE_URL_ENV] ?? DEFAULT_CONTROL_PLANE_BASE_URL),
	};
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
	};
}

export class ControlPlaneClient {
	readonly baseUrl: string;
	readonly accessToken: string | null;
	readonly fetchImpl: typeof fetch;
	readonly userAgent?: string;

	constructor(readonly options: ControlPlaneClientOptions) {
		this.baseUrl = normalizeBaseUrl(options.profile.baseUrl);
		this.accessToken = options.accessToken ?? null;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.userAgent = options.userAgent;
	}

	async call<T>(options: ControlPlaneCallOptions): Promise<ControlPlaneResponseEnvelope<T>> {
		const headers = new Headers(options.headers);
		headers.set('accept', 'application/json, application/problem+json');
		if (this.accessToken) headers.set('authorization', `Bearer ${this.accessToken}`);
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
