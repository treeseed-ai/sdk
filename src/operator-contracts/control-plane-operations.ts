import { z } from 'zod';
import {
	CONTROL_PLANE_OPERATION_SCHEMA_VERSION,
	type ControlPlaneOperationBinding,
	type ControlPlaneOperationDescriptor,
} from './control-plane-operation.ts';

const empty = z.object({}).strict();
const none = z.undefined();
const record = z.record(z.unknown());
const payload = record;

type Definition = Omit<ControlPlaneOperationDescriptor, 'schemaVersion' | 'schemas' | 'idempotency' | 'concurrency' | 'audited' | 'receipt' | 'redactedPaths'> & {
	parameters?: string;
	redactedPaths?: string[];
};

function define<TPath, TQuery, TBody, TOutput>(
	definition: Definition,
	schema: ControlPlaneOperationBinding<TPath, TQuery, TBody, TOutput>['schema'],
): ControlPlaneOperationBinding<TPath, TQuery, TBody, TOutput> {
	const { parameters, redactedPaths = [], ...descriptor } = definition;
	const mutation = definition.kind === 'mutation';
	return {
		descriptor: {
			...descriptor,
			schemaVersion: CONTROL_PLANE_OPERATION_SCHEMA_VERSION,
			schemas: {
				input: `treeseed.${definition.operationId}.input/v1`,
				output: `treeseed.${definition.operationId}.output/v1`,
				errors: 'treeseed.problem/v1',
				...(parameters ? { parameters } : {}),
			},
			idempotency: { required: mutation, header: 'Idempotency-Key' },
			concurrency: { required: mutation, readHeader: 'ETag', writeHeader: 'If-Match' },
			audited: definition.surfaces.some((surface) => surface !== 'internal'),
			receipt: mutation,
			redactedPaths,
		},
		schema,
	};
}

function read(operationId: `${string}.${string}`, path: `/v1/${string}`, capability: string, surfaces: ControlPlaneOperationDescriptor['surfaces'] = ['rest']) {
	return define({
		operationId, description: `Read ${operationId}.`, rest: { method: 'GET', path }, capability,
		oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never',
		surfaces, cacheScope: 'principal', pagination: 'none',
	}, { path: empty, query: empty, body: none, output: payload });
}

function providerPath<T extends z.ZodRawShape>(
	operationId: `${string}.${string}`,
	method: 'GET' | 'POST' | 'PUT',
	path: `/v1/${string}`,
	pathShape: T,
	options: { read?: boolean; redactedPaths?: string[] } = {},
) {
	const kind = options.read ? 'read' : 'mutation';
	return define({
		operationId, description: `${kind === 'read' ? 'Read' : 'Apply'} ${operationId}.`, rest: { method, path },
		parameters: `treeseed.${operationId}.parameters/v1`, capability: 'providers.execute', oauthScopes: ['treeseed:execution'],
		kind, riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest'], cacheScope: 'none', pagination: 'none',
		redactedPaths: options.redactedPaths,
	}, { path: z.object(pathShape).strict(), query: empty, body: method === 'GET' ? none : record, output: payload });
}

const noPathProvider = (operationId: `${string}.${string}`, method: 'GET' | 'POST' | 'PUT', path: `/v1/${string}`, options: { read?: boolean; redactedPaths?: string[] } = {}) =>
	define({
		operationId, description: `${options.read ? 'Read' : 'Apply'} ${operationId}.`, rest: { method, path },
		capability: 'providers.execute', oauthScopes: ['treeseed:execution'], kind: options.read ? 'read' : 'mutation',
		riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest'], cacheScope: 'none', pagination: 'none',
		redactedPaths: options.redactedPaths,
	}, { path: empty, query: empty, body: method === 'GET' ? none : record, output: payload });

export const CONTROL_PLANE_OPERATIONS = {
	status: {
		show: read('status.show', '/v1/status', 'status.read', ['rest', 'cli', 'mcp_tool', 'mcp_resource']),
	},
	health: {
		ready: read('health.ready', '/v1/health/ready', 'health.read'),
		deep: read('health.deep', '/v1/health/deep', 'health.read'),
	},
	projects: {
		list: define({
			operationId: 'projects.list', description: 'List projects visible to the principal.', rest: { method: 'GET', path: '/v1/projects' },
			capability: 'projects.read', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never',
			surfaces: ['rest', 'cli', 'mcp_tool'], cacheScope: 'principal', pagination: 'cursor',
		}, { path: empty, query: z.object({ teamId: z.string().min(1).optional(), limit: z.number().int().positive().max(200).optional(), cursor: z.string().min(1).optional() }).strict(), body: none, output: payload }),
	},
	providers: {
		register: noPathProvider('providers.register', 'POST', '/v1/provider-registrations', { redactedPaths: ['body.registrationKey'] }),
		registration: providerPath('providers.registration.show', 'GET', '/v1/provider-registrations/{requestId}', { requestId: z.string().min(1) }, { read: true }),
		exchangeCredential: providerPath('providers.registration.credential', 'POST', '/v1/provider-registrations/{requestId}/credential', { requestId: z.string().min(1) }, { redactedPaths: ['body.proof'] }),
		issueAccessToken: noPathProvider('providers.token.issue', 'POST', '/v1/provider/access-tokens', { redactedPaths: ['body.credential', 'body.proof'] }),
		leaveMembership: noPathProvider('providers.membership.leave', 'POST', '/v1/provider/membership/leave'),
		rotateIdentity: noPathProvider('providers.identity.rotate', 'POST', '/v1/provider/identity/rotate', { redactedPaths: ['body.oldProof', 'body.newProof'] }),
		rotateCredential: noPathProvider('providers.credential.rotate', 'POST', '/v1/provider/credential-rotation'),
		createAvailability: noPathProvider('providers.availability.create', 'POST', '/v1/provider/availability-sessions'),
		refreshAvailability: providerPath('providers.availability.refresh', 'PUT', '/v1/provider/availability-sessions/{sessionId}', { sessionId: z.string().min(1) }),
		closeAvailability: providerPath('providers.availability.close', 'POST', '/v1/provider/availability-sessions/{sessionId}/close', { sessionId: z.string().min(1) }),
		nextAssignment: noPathProvider('providers.assignments.next', 'POST', '/v1/provider/assignments/next'),
		assignment: providerPath('providers.assignments.show', 'GET', '/v1/provider/assignments/{assignmentId}', { assignmentId: z.string().min(1) }, { read: true }),
		assignmentExplanation: providerPath('providers.assignments.explain', 'GET', '/v1/provider/assignments/{assignmentId}/explanation', { assignmentId: z.string().min(1) }, { read: true }),
		renewAssignment: providerPath('providers.assignments.renew', 'POST', '/v1/provider/assignments/{assignmentId}/renew', { assignmentId: z.string().min(1) }),
		startExecution: providerPath('providers.assignments.execution.start', 'POST', '/v1/provider/assignments/{assignmentId}/execution-start', { assignmentId: z.string().min(1) }),
		startCloseout: providerPath('providers.assignments.closeout.start', 'POST', '/v1/provider/assignments/{assignmentId}/closeout-start', { assignmentId: z.string().min(1) }),
		completionPreflight: providerPath('providers.assignments.completion.preflight', 'POST', '/v1/provider/assignments/{assignmentId}/completion-preflight', { assignmentId: z.string().min(1) }),
		returnAssignment: providerPath('providers.assignments.return', 'POST', '/v1/provider/assignments/{assignmentId}/return', { assignmentId: z.string().min(1) }),
		completeAssignment: providerPath('providers.assignments.complete', 'POST', '/v1/provider/assignments/{assignmentId}/complete', { assignmentId: z.string().min(1) }),
		failAssignment: providerPath('providers.assignments.fail', 'POST', '/v1/provider/assignments/{assignmentId}/fail', { assignmentId: z.string().min(1) }),
		reportUsage: providerPath('providers.assignments.usage', 'POST', '/v1/provider/assignments/{assignmentId}/usage', { assignmentId: z.string().min(1) }),
		settleAssignment: providerPath('providers.assignments.settle', 'POST', '/v1/provider/assignments/{assignmentId}/settle', { assignmentId: z.string().min(1) }),
		createModeRun: providerPath('providers.assignments.mode.run', 'POST', '/v1/provider/assignments/{assignmentId}/mode-runs', { assignmentId: z.string().min(1) }),
		createEvent: providerPath('providers.assignments.event.create', 'POST', '/v1/provider/assignments/{assignmentId}/events', { assignmentId: z.string().min(1) }),
		publishSignal: providerPath('providers.assignments.signal.publish', 'POST', '/v1/provider/assignments/{assignmentId}/signals', { assignmentId: z.string().min(1) }),
		dispatchWorkflow: providerPath('providers.assignments.workflow.dispatch', 'POST', '/v1/provider/assignments/{assignmentId}/workflow-operations/{operationId}/dispatch', { assignmentId: z.string().min(1), operationId: z.string().min(1) }),
		workflowRun: providerPath('providers.assignments.workflow.show', 'GET', '/v1/provider/assignments/{assignmentId}/workflow-runs/{runId}', { assignmentId: z.string().min(1), runId: z.string().min(1) }, { read: true }),
	},
} as const;

function flatten(value: unknown, output: ControlPlaneOperationBinding<any, any, any, any>[] = []) {
	if (value && typeof value === 'object' && 'descriptor' in value && 'schema' in value) output.push(value as ControlPlaneOperationBinding<any, any, any, any>);
	else if (value && typeof value === 'object') for (const child of Object.values(value)) flatten(child, output);
	return output;
}

export const CONTROL_PLANE_OPERATION_LIST = Object.freeze(flatten(CONTROL_PLANE_OPERATIONS));
export const CONTROL_PLANE_CATALOG = Object.freeze({
	schemaVersion: 'treeseed.control-plane-catalog/v1' as const,
	operations: CONTROL_PLANE_OPERATION_LIST.map((operation) => operation.descriptor),
});

export function controlPlaneOperation(operationId: string) {
	const operation = CONTROL_PLANE_OPERATION_LIST.find((candidate) => candidate.descriptor.operationId === operationId);
	if (!operation) throw new Error(`Unknown control-plane operation ${operationId}.`);
	return operation;
}
