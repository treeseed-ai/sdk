import { z } from 'zod';
import { defineOperation } from '../operation-builder.ts';
import {
	communicationSendReceiptSchema,
	communicationSendRequestSchema,
	providerDiscussionResponseReceiptSchema,
	providerDiscussionResponseRequestSchema,
} from '../communication/contracts.ts';

const empty = z.object({}).strict();
const none = z.undefined();

export function communicationOperations() {
	return {
		send: defineOperation({ operationId: 'communications.send', description: 'Post a team-channel message and admit the selected project agents to the communication lane.', rest: { method: 'POST', path: '/v1/teams/{teamId}/channels/{channel}/messages' }, parameters: 'treeseed.communications.send.parameters/v1', capability: 'agents.execute', authentication: 'oauth', oauthScopes: ['treeseed:execution'], kind: 'mutation', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest', 'cli', 'mcp_tool'], cacheScope: 'none', pagination: 'none' }, {
			path: z.object({ teamId: z.string().min(1), channel: z.string().trim().min(1).max(120) }).strict(), query: empty, body: communicationSendRequestSchema, output: communicationSendReceiptSchema,
		}),
		sendStatus: defineOperation({ operationId: 'communications.sends.show', description: 'Read a communication send and its durable agent responses.', rest: { method: 'GET', path: '/v1/teams/{teamId}/communication-sends/{sendId}' }, parameters: 'treeseed.communications.sends.show.parameters/v1', capability: 'agents.read', authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest', 'mcp_tool', 'mcp_resource'], cacheScope: 'principal', pagination: 'none' }, {
			path: z.object({ teamId: z.string().min(1), sendId: z.string().min(1) }).strict(), query: empty, body: none, output: communicationSendReceiptSchema,
		}),
	};
}

export function providerDiscussionResponseOperation() {
	return defineOperation({ operationId: 'providers.assignments.discussion.respond', description: 'Commit and settle an assignment-scoped discussion response.', rest: { method: 'POST', path: '/v1/provider/assignments/{assignmentId}/discussion-response' }, parameters: 'treeseed.providers.assignments.discussion.respond.parameters/v1', capability: 'providers.execute', authentication: 'provider', oauthScopes: [], kind: 'mutation', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest'], cacheScope: 'none', pagination: 'none' }, {
		path: z.object({ assignmentId: z.string().min(1) }).strict(), query: empty, body: providerDiscussionResponseRequestSchema, output: providerDiscussionResponseReceiptSchema,
	});
}
