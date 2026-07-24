import type { TreeDxErrorCode } from '../types.ts';

export class TreeDxApiError extends Error {
	readonly status: number;
	readonly code: TreeDxErrorCode;
	readonly details: Record<string, unknown>;
	readonly payload: unknown;

	constructor(message: string, options: {
		status: number;
		code?: TreeDxErrorCode;
		details?: Record<string, unknown>;
		payload?: unknown;
	}) {
		super(message);
		this.name = 'TreeDxApiError';
		this.status = options.status;
		this.code = options.code ?? 'treedx_api_error';
		this.details = options.details ?? {};
		this.payload = options.payload;
	}
}
