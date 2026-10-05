import type { ControlPlaneClient, ControlPlaneOperationCallOptions } from '../entrypoints/clients/control-plane-client.ts';
import { treeAiControlPlaneOperation } from './catalog.ts';
import { TREEAI_UPSTREAM_OPERATIONS } from './generated/upstream.ts';

export type TreeAiService = typeof TREEAI_UPSTREAM_OPERATIONS[number]['service'];
export type TreeAiOperationId = typeof TREEAI_UPSTREAM_OPERATIONS[number]['operationId'];
export interface TreeAiInvocation { path?: Record<string, string | number>; query?: Record<string, string | number | boolean | undefined>; body?: unknown; headers?: Record<string, string> }

export interface TreeAiDirectOptions {
	endpoints: Record<TreeAiService, string>;
	token?: string | (() => string | Promise<string>);
	fetch?: typeof fetch;
}

export class TreeSeedTreeAiClient {
	readonly operations = TREEAI_UPSTREAM_OPERATIONS;
	private constructor(private readonly direct: TreeAiDirectOptions | null, private readonly controlPlane: ControlPlaneClient | null, private readonly nodeId: string | null) {}

	static direct(options: TreeAiDirectOptions) { return new TreeSeedTreeAiClient(options, null, null); }
	static controlPlane(client: ControlPlaneClient, nodeId: string) { return new TreeSeedTreeAiClient(null, client, nodeId); }

	async invoke(operationId: TreeAiOperationId, input: TreeAiInvocation = {}, options: ControlPlaneOperationCallOptions = {}) {
		const operation = TREEAI_UPSTREAM_OPERATIONS.find((item) => item.operationId === operationId);
		if (!operation) throw new Error(`Unknown TreeAI operation ${operationId}.`);
		if (this.controlPlane) {
			const binding = treeAiControlPlaneOperation(operationId);
			return this.controlPlane.invoke(binding, { path: { nodeId: this.nodeId!, ...(input.path ?? {}) }, query: input.query ?? {}, body: operation.kind === 'read' ? undefined : input.body ?? {} }, options);
		}
		if (!this.direct) throw new Error('TreeAI transport is not configured.');
		let path = operation.path as string;
		for (const [name, value] of Object.entries(input.path ?? {})) path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
		if (/\{[^}]+\}/u.test(path)) throw new Error(`TreeAI operation ${operationId} is missing path parameters.`);
		const url = new URL(path, `${this.direct.endpoints[operation.service].replace(/\/$/u, '')}/`);
		for (const [name, value] of Object.entries(input.query ?? {})) if (value !== undefined) url.searchParams.set(name, String(value));
		const token = typeof this.direct.token === 'function' ? await this.direct.token() : this.direct.token;
		const headers = new Headers(input.headers); if (token) headers.set('authorization', `Bearer ${token}`);
		if (input.body !== undefined) headers.set('content-type', 'application/json');
		const response = await (this.direct.fetch ?? fetch)(url, { method: operation.method, headers, body: input.body === undefined ? undefined : JSON.stringify(input.body) });
		const payload = (response.headers.get('content-type') ?? '').includes('json') ? await response.json() : await response.text();
		if (!response.ok) throw Object.assign(new Error(`TreeAI ${operationId} returned ${response.status}.`), { status: response.status, payload });
		return payload;
	}
}
