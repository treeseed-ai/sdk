import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { ControlPlaneOperationDescriptor, OAuthScope } from '../../operator-contracts/control-plane-operation.ts';
import type { ApiPrincipal } from './remote.ts';

export const DEFAULT_CONTROL_PLANE_BASE_URL = 'http://127.0.0.1:3002';
export const CONTROL_PLANE_BASE_URL_ENV = 'TREESEED_API_BASE_URL';
export const CONTROL_PLANE_SERVER_REGISTRY_PATH = '.treeseed/config/servers.json';
export const CONTROL_PLANE_SERVER_SESSIONS_PATH = '.treeseed/auth/server-sessions.enc.json';
export const CONTROL_PLANE_SERVER_SESSION_KEY_PATH = '.treeseed/auth/server-sessions.key';

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

export interface ControlPlaneOperationBinding<TInput = unknown, TOutput = unknown> {
	descriptor: ControlPlaneOperationDescriptor;
	readonly __input?: TInput;
	readonly __output?: TOutput;
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

export interface ControlPlaneOperationCallOptions {
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

function registryPath(env: Record<string, string | undefined> = process.env) {
	return resolve(env.HOME?.trim() || homedir(), CONTROL_PLANE_SERVER_REGISTRY_PATH);
}

function normalizeServer(profile: ControlPlaneServerProfile): ControlPlaneServerProfile {
	const serverId = profile.serverId.trim();
	if (!serverId) throw new Error('Control-plane server IDs cannot be empty.');
	return { serverId, label: profile.label.trim() || serverId, baseUrl: normalizeControlPlaneBaseUrl(profile.baseUrl) };
}

export function loadControlPlaneServerRegistry(env: Record<string, string | undefined> = process.env): ControlPlaneServerRegistry {
	const local = defaultLocalControlPlaneServer(env);
	const path = registryPath(env);
	if (!existsSync(path)) return { version: 1, activeServerId: local.serverId, servers: [local] };
	const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ControlPlaneServerRegistry>;
	const byId = new Map<string, ControlPlaneServerProfile>([[local.serverId, local]]);
	for (const value of Array.isArray(parsed.servers) ? parsed.servers : []) {
		const normalized = normalizeServer(value);
		byId.set(normalized.serverId, normalized);
	}
	const servers = [...byId.values()].sort((left, right) => left.serverId.localeCompare(right.serverId));
	const activeServerId = servers.some((entry) => entry.serverId === parsed.activeServerId) ? parsed.activeServerId! : local.serverId;
	return { version: 1, activeServerId, servers };
}

export function writeControlPlaneServerRegistry(state: ControlPlaneServerRegistry, env: Record<string, string | undefined> = process.env) {
	const path = registryPath(env);
	const servers = [...new Map(state.servers.map((entry) => {
		const normalized = normalizeServer(entry);
		return [normalized.serverId, normalized];
	})).values()].sort((left, right) => left.serverId.localeCompare(right.serverId));
	const activeServerId = servers.some((entry) => entry.serverId === state.activeServerId) ? state.activeServerId : 'local';
	const next: ControlPlaneServerRegistry = { version: 1, activeServerId, servers };
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
	return next;
}

export function resolveControlPlaneServer(selector?: string | null, env: Record<string, string | undefined> = process.env) {
	const value = selector?.trim();
	if (value && /^https?:\/\//iu.test(value)) {
		return normalizeServer({ serverId: value.replace(/^https?:\/\//iu, '').replace(/[^a-z0-9._-]+/giu, '-'), label: value, baseUrl: value });
	}
	const registry = loadControlPlaneServerRegistry(env);
	const serverId = value || registry.activeServerId;
	const profile = registry.servers.find((entry) => entry.serverId === serverId);
	if (!profile) throw new Error(`Unknown control-plane server "${serverId}".`);
	return profile;
}

export function resolveControlPlaneServerSession(root: string, serverId: string): ControlPlaneServerSession | null {
	try {
		return readServerSessions(root)[serverId] ?? null;
	} catch {
		return null;
	}
}

export function setControlPlaneServerSession(root: string, session: ControlPlaneServerSession) {
	const sessions = readServerSessions(root);
	sessions[session.serverId] = session;
	writeServerSessions(root, sessions);
	return session;
}

export function clearControlPlaneServerSession(root: string, serverId?: string | null) {
	if (!serverId) {
		writeServerSessions(root, {});
		return;
	}
	const sessions = readServerSessions(root);
	delete sessions[serverId];
	writeServerSessions(root, sessions);
}

function sessionPaths(root: string) {
	return { sessions: resolve(root, CONTROL_PLANE_SERVER_SESSIONS_PATH), key: resolve(root, CONTROL_PLANE_SERVER_SESSION_KEY_PATH) };
}

function sessionKey(root: string) {
	const paths = sessionPaths(root);
	if (existsSync(paths.key)) {
		const key = Buffer.from(readFileSync(paths.key, 'utf8').trim(), 'base64url');
		if (key.length !== 32) throw new Error('Control-plane session key is invalid.');
		return key;
	}
	mkdirSync(dirname(paths.key), { recursive: true });
	const key = randomBytes(32);
	writeFileSync(paths.key, `${key.toString('base64url')}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
	return key;
}

function readServerSessions(root: string): Record<string, ControlPlaneServerSession> {
	const paths = sessionPaths(root);
	if (!existsSync(paths.sessions)) return {};
	const envelope = JSON.parse(readFileSync(paths.sessions, 'utf8')) as { version: 1; iv: string; tag: string; ciphertext: string };
	if (envelope.version !== 1) throw new Error('Unsupported control-plane session format.');
	const decipher = createDecipheriv('aes-256-gcm', sessionKey(root), Buffer.from(envelope.iv, 'base64url'));
	decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
	const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]);
	return JSON.parse(plaintext.toString('utf8')) as Record<string, ControlPlaneServerSession>;
}

function writeServerSessions(root: string, sessions: Record<string, ControlPlaneServerSession>) {
	const paths = sessionPaths(root);
	mkdirSync(dirname(paths.sessions), { recursive: true });
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', sessionKey(root), iv);
	const ciphertext = Buffer.concat([cipher.update(JSON.stringify(sessions), 'utf8'), cipher.final()]);
	const envelope = { version: 1 as const, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
	const temporary = `${paths.sessions}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(envelope)}\n`, { encoding: 'utf8', mode: 0o600 });
	renameSync(temporary, paths.sessions);
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
		this.baseUrl = normalizeControlPlaneBaseUrl(options.profile.baseUrl);
		this.accessToken = options.accessToken ?? null;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.userAgent = options.userAgent;
	}

	async callOperation<TInput, TOutput>(binding: ControlPlaneOperationBinding<TInput, TOutput>, input: TInput, options: ControlPlaneOperationCallOptions = {}) {
		const rest = binding.descriptor.rest;
		if (!rest) throw new Error(`Operation ${binding.descriptor.operationId} has no REST binding.`);
		if (/[:*]/u.test(rest.path)) throw new Error(`Operation ${binding.descriptor.operationId} requires generated path parameters.`);
		return this.call<TOutput>({ method: rest.method, path: rest.path as `/v1/${string}`, input: rest.method === 'GET' ? undefined : input, ...options });
	}

	async authorizeDevice(clientId: string, scope: OAuthScope[], signal?: AbortSignal): Promise<OAuthDeviceAuthorizationReceipt> {
		const response = await this.fetchImpl(`${this.baseUrl}/oauth/device_authorization`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, scope: scope.join(' ') }), signal });
		const payload = await responsePayload(response) as Record<string, unknown>;
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
		const payload = await responsePayload(response) as Record<string, unknown>;
		if (!response.ok) throw new ControlPlaneClientError(String(payload.error_description ?? payload.error ?? 'OAuth token exchange failed.'), response.status, problemFrom(payload, response.status), response.headers);
		return { tokenType: 'Bearer', accessToken: String(payload.access_token), refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined, expiresIn: Number(payload.expires_in), scope: String(payload.scope ?? '').split(/\s+/u).filter(Boolean) as OAuthScope[], audience: String(payload.audience ?? this.baseUrl), principal: payload.principal && typeof payload.principal === 'object' ? payload.principal as ApiPrincipal : undefined };
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
