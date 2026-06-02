export class TreeDbApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details: Record<string, unknown>;
	readonly payload: unknown;

	constructor(message: string, options: {
		status: number;
		code?: string;
		details?: Record<string, unknown>;
		payload?: unknown;
	}) {
		super(message);
		this.name = 'TreeDbApiError';
		this.status = options.status;
		this.code = options.code ?? 'treedb_api_error';
		this.details = options.details ?? {};
		this.payload = options.payload;
	}
}
