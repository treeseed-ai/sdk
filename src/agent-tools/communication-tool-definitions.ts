import type { AgentToolDefinition } from './agent-tool-execution-target.ts';
import { GENERIC_RESULT_SCHEMA } from './agent-tool-execution-target.ts';

const identity = { type: 'string', minLength: 1, maxLength: 256 } as const;
const idempotency = { type: 'string', minLength: 8, maxLength: 256 } as const;

export const COMMUNICATION_TOOL_DEFINITIONS: AgentToolDefinition[] = [
	{
		id: 'treeseed.discussion.read', title: 'Read assignment discussion', description: 'Read bounded TreeDX-backed discussion messages scoped to the current assignment project.',
		inputSchema: { type: 'object', properties: { discussionId: identity, query: { type: 'string', maxLength: 500 }, after: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
		outputSchema: GENERIC_RESULT_SCHEMA, executionTarget: 'provider_runner', mutability: 'read', telemetryCategory: 'content', requirements: ['provider_runner_runtime'],
	},
	{
		id: 'treeseed.discussion.follow', title: 'Follow assignment discussion', description: 'Read durable messages and lifecycle events after an exact cursor. Transient token deltas are not reconstructed.',
		inputSchema: { type: 'object', properties: { discussionId: identity, after: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['discussionId'], additionalProperties: false },
		outputSchema: GENERIC_RESULT_SCHEMA, executionTarget: 'provider_runner', mutability: 'read', telemetryCategory: 'content', requirements: ['provider_runner_runtime'],
	},
	{
		id: 'treeseed.discussion.respond', title: 'Respond to assignment discussion', description: 'Commit the authoritative assignment-authored response through TreeDX after completed discussion.read and discussion.follow receipts. With requiredResponse=true this tool owns suspended-summary authoring, the assignment checkpoint, lease release, and continuation provenance; call it before a terminal summary or content commit.',
		inputSchema: { type: 'object', properties: { discussionId: identity, replyTo: identity, sourceMessageRefs: { type: 'array', uniqueItems: true, maxItems: 24, items: identity }, topic: { type: 'string', minLength: 1, maxLength: 500 }, message: { type: 'string', minLength: 1, maxLength: 12000 }, recipients: { type: 'array', uniqueItems: true, maxItems: 16, items: identity }, requiredResponse: { type: 'boolean' }, expectedStateVersion: { type: 'integer', minimum: 1 }, idempotencyKey: idempotency }, required: ['message', 'sourceMessageRefs', 'expectedStateVersion', 'idempotencyKey'], additionalProperties: false },
		outputSchema: GENERIC_RESULT_SCHEMA, executionTarget: 'provider_runner', mutability: 'shared_state_write', telemetryCategory: 'content', requirements: ['provider_runner_runtime'],
	},
	{
		id: 'treeseed.discussion.request_handoff', title: 'Request agent discussion handoff', description: 'Request an API-governed, bounded agent-to-agent communication invocation without widening authority or productive time.',
		inputSchema: { type: 'object', properties: { discussionId: identity, sourceMessageRefs: { type: 'array', uniqueItems: true, maxItems: 24, items: identity }, recipientAgentIds: { type: 'array', uniqueItems: true, minItems: 1, maxItems: 2, items: identity }, subject: { type: 'string', minLength: 1, maxLength: 1000 }, expectedStateVersion: { type: 'integer', minimum: 1 }, idempotencyKey: idempotency }, required: ['discussionId', 'sourceMessageRefs', 'recipientAgentIds', 'subject', 'expectedStateVersion', 'idempotencyKey'], additionalProperties: false },
		outputSchema: GENERIC_RESULT_SCHEMA, executionTarget: 'provider_runner', mutability: 'shared_state_write', telemetryCategory: 'capacity', requirements: ['provider_runner_runtime'],
	},
	{
		id: 'treeseed.discussion.create_artifact', title: 'Create linked discussion artifact', description: 'Create a permitted proposal, question, or linked note from exact Discussion messages through assignment-scoped TreeDX authority.',
		inputSchema: { type: 'object', properties: { discussionId: identity, sourceMessageRefs: { type: 'array', uniqueItems: true, minItems: 1, maxItems: 24, items: identity }, model: { type: 'string', enum: ['proposal', 'question', 'note'] }, path: identity, content: { type: 'string', minLength: 1, maxLength: 50000 }, expectedStateVersion: { type: 'integer', minimum: 1 }, idempotencyKey: idempotency }, required: ['discussionId', 'sourceMessageRefs', 'model', 'path', 'content', 'expectedStateVersion', 'idempotencyKey'], additionalProperties: false },
		outputSchema: GENERIC_RESULT_SCHEMA, executionTarget: 'provider_runner', mutability: 'content_write', telemetryCategory: 'content', requirements: ['provider_runner_runtime', 'treedx_proxy_handle', 'treedx_writable_workspace'],
	},
	{
		id: 'treeseed.operation.prepare_handoff', title: 'Prepare governed operation handoff', description: 'Prepare exact operation inputs and approval provenance. It never creates acting authority directly.',
		inputSchema: { type: 'object', properties: { discussionId: identity, target: identity, expectedEffect: { type: 'string', minLength: 1, maxLength: 4000 }, sourceMessageRefs: { type: 'array', uniqueItems: true, minItems: 1, maxItems: 24, items: identity }, requiredAuthority: { type: 'array', uniqueItems: true, items: identity }, proposalId: identity, decisionId: identity, expectedStateVersion: { type: 'integer', minimum: 1 }, idempotencyKey: idempotency }, required: ['discussionId', 'target', 'expectedEffect', 'sourceMessageRefs', 'requiredAuthority', 'expectedStateVersion', 'idempotencyKey'], additionalProperties: false },
		outputSchema: GENERIC_RESULT_SCHEMA, executionTarget: 'provider_runner', mutability: 'shared_state_write', telemetryCategory: 'governance', requirements: ['provider_runner_runtime'],
	},
	{
		id: 'treeseed.client_session.request_action', title: 'Request semantic client action', description: 'Request a bounded navigation, reveal, filter, draft, or confirmation action from an authenticated matching client session.',
		inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['navigate', 'reveal-resource', 'set-view-filter', 'populate-draft', 'present-confirmation'] }, payload: { type: 'object', additionalProperties: true }, ttlSeconds: { type: 'integer', minimum: 1, maximum: 300 }, expectedStateVersion: { type: 'integer', minimum: 1 }, idempotencyKey: idempotency }, required: ['kind', 'payload', 'ttlSeconds', 'expectedStateVersion', 'idempotencyKey'], additionalProperties: false },
		outputSchema: GENERIC_RESULT_SCHEMA, executionTarget: 'provider_runner', mutability: 'shared_state_write', telemetryCategory: 'client', requirements: ['provider_runner_runtime'],
	},
];
