export interface TreeDbClientConfig {
	baseUrl: string;
	token?: string;
	fetchImpl?: typeof fetch;
	transport?: Transport;
	defaultHeaders?: Record<string, string>;
}

export interface TreeDbRequest {
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	path: string;
	query?: Record<string, string | number | boolean | undefined>;
	headers?: Record<string, string>;
	body?: unknown;
	binaryBody?: Uint8Array | ArrayBuffer | Buffer | ReadableStream<Uint8Array>;
}

export interface TreeDbResponse<T = unknown> {
	status: number;
	headers: Record<string, string>;
	data: T;
}

export interface Transport {
	request<T = unknown>(request: TreeDbRequest): Promise<TreeDbResponse<T>>;
}

export class TreeDbApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details?: unknown;
	readonly payload?: unknown;
	readonly cause?: unknown;

	constructor(input: { status: number; code: string; message: string; details?: unknown; payload?: unknown; cause?: unknown }) {
		super(input.message);
		this.name = 'TreeDbApiError';
		this.status = input.status;
		this.code = input.code;
		this.details = input.details;
		this.payload = input.payload;
		this.cause = input.cause;
	}

	static fromResponse(status: number, payload: unknown) {
		const envelope = payload as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
		return new TreeDbApiError({
			status,
			code: envelope?.error?.code ?? 'internal_error',
			message: envelope?.error?.message ?? `TreeDB request failed with status ${status}`,
			details: envelope?.error?.details,
			payload,
		});
	}

	static network(message: string, cause?: unknown) {
		return new TreeDbApiError({
			status: 0,
			code: 'network_error',
			message,
			cause,
		});
	}
}

class FetchTreeDbTransport implements Transport {
	constructor(private readonly config: TreeDbClientConfig) {}

	async request<T = unknown>(request: TreeDbRequest): Promise<TreeDbResponse<T>> {
		const fetchImpl = this.config.fetchImpl ?? globalThis.fetch;
		if (!fetchImpl) throw TreeDbApiError.network('fetch is not available in this runtime');
		const url = new URL(request.path, this.config.baseUrl);
		for (const [key, value] of Object.entries(request.query ?? {})) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}
		const headers = new Headers({
			...(this.config.defaultHeaders ?? {}),
			...(request.headers ?? {}),
		});
		if (this.config.token) headers.set('Authorization', `Bearer ${this.config.token}`);
		let body: BodyInit | undefined;
		if (request.binaryBody) {
			body = request.binaryBody as BodyInit;
		} else if (request.body !== undefined) {
			headers.set('Content-Type', headers.get('Content-Type') ?? 'application/json');
			body = JSON.stringify(request.body);
		}
		try {
			const response = await fetchImpl(url, {
				method: request.method,
				headers,
				body,
			});
			const contentType = response.headers.get('content-type') ?? '';
			const data = contentType.includes('application/json')
				? await response.json()
				: await response.text();
			if (!response.ok) throw TreeDbApiError.fromResponse(response.status, data);
			return {
				status: response.status,
				headers: Object.fromEntries(response.headers.entries()),
				data: data as T,
			};
		} catch (error) {
			if (error instanceof TreeDbApiError) throw error;
			throw TreeDbApiError.network(error instanceof Error ? error.message : 'TreeDB request failed', error);
		}
	}
}

function segment(value: string) {
	return encodeURIComponent(value);
}

async function requestData<T = unknown>(transport: Transport, request: TreeDbRequest): Promise<T> {
	const response = await transport.request<T>(request);
	return response.data;
}

export class TreeDbClient {
	readonly transport: Transport;
	readonly repositories: RepositoriesAdapter;
	readonly query: QueryAdapter;
	readonly files: FilesAdapter;
	readonly graph: GraphAdapter;
	readonly federation: FederationAdapter;
	readonly exec: ExecAdapter;

	constructor(readonly config: TreeDbClientConfig) {
		this.transport = config.transport ?? new FetchTreeDbTransport(config);
		this.repositories = new RepositoriesAdapter(this.transport);
		this.query = new QueryAdapter(this.transport);
		this.files = new FilesAdapter(this.transport);
		this.graph = new GraphAdapter(this.transport);
		this.federation = new FederationAdapter(this.transport);
		this.exec = new ExecAdapter(this.transport);
	}
}

class RepositoriesAdapter {
	constructor(private readonly transport: Transport) {}

	list() {
		return requestData(this.transport, { method: 'GET', path: '/api/v1/repos' });
	}
}

class QueryAdapter {
	constructor(private readonly transport: Transport) {}

	readFile(repoId: string, body: unknown) {
		return requestData(this.transport, { method: 'POST', path: `/api/v1/repos/${segment(repoId)}/files/read`, body });
	}

	listPaths(repoId: string, body: unknown) {
		return requestData(this.transport, { method: 'POST', path: `/api/v1/repos/${segment(repoId)}/paths/list`, body });
	}
}

class FilesAdapter {
	constructor(private readonly transport: Transport) {}

	write(workspaceId: string, body: unknown) {
		return requestData(this.transport, { method: 'PUT', path: `/api/v1/workspaces/${segment(workspaceId)}/files`, body });
	}

	patch(workspaceId: string, body: unknown) {
		return requestData(this.transport, { method: 'PATCH', path: `/api/v1/workspaces/${segment(workspaceId)}/files`, body });
	}
}

class GraphAdapter {
	constructor(private readonly transport: Transport) {}

	refresh(repoId: string, body: unknown) {
		return requestData(this.transport, { method: 'POST', path: `/api/v1/repos/${segment(repoId)}/graph/refresh`, body });
	}
}

class FederationAdapter {
	constructor(private readonly transport: Transport) {}

	graphQuery(body: unknown) {
		return requestData(this.transport, { method: 'POST', path: '/api/v1/graph/query', body });
	}

	contextBuild(body: unknown) {
		return requestData(this.transport, { method: 'POST', path: '/api/v1/context/build', body });
	}
}

class ExecAdapter {
	constructor(private readonly transport: Transport) {}

	run(workspaceId: string, body: unknown) {
		return requestData(this.transport, { method: 'POST', path: `/api/v1/workspaces/${segment(workspaceId)}/exec`, body });
	}
}
