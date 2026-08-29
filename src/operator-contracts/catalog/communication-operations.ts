import { z } from 'zod';
import { defineOperation } from '../operation-builder.ts';
import {
	communicationSendReceiptSchema,
	communicationSendRequestSchema,
	communicationTopicPageSchema, communicationTopicSchema, communicationTopicSubscriptionReceiptSchema,
	communicationTopicSubscriptionRequestSchema, communicationTopicTimelineSchema,
	providerCommunicationNotificationAcknowledgeRequestSchema, providerCommunicationTraceEventRequestSchema,
	providerDiscussionResponseReceiptSchema,
	providerDiscussionResponseRequestSchema,
} from '../communication/contracts.ts';

const empty = z.object({}).strict();
const none = z.undefined();

export function communicationOperations() {
	return {
		send: defineOperation({ operationId: 'communications.send', description: 'Post a team discussion-topic message and admit every addressed team agent to its project communication stream.', rest: { method: 'POST', path: '/v1/teams/{teamId}/discussion-topics/{channel}/messages' }, parameters: 'treeseed.communications.send.parameters/v3', capability: 'agents.execute', authentication: 'oauth', oauthScopes: ['treeseed:execution'], kind: 'mutation', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest', 'cli', 'mcp_tool'], cacheScope: 'none', pagination: 'none' }, {
			path: z.object({ teamId: z.string().min(1), channel: z.string().trim().min(1).max(120) }).strict(), query: empty, body: communicationSendRequestSchema, output: communicationSendReceiptSchema,
		}),
		sendStatus: defineOperation({ operationId: 'communications.sends.show', description: 'Read a communication send and its durable agent responses.', rest: { method: 'GET', path: '/v1/teams/{teamId}/communication-sends/{sendId}' }, parameters: 'treeseed.communications.sends.show.parameters/v1', capability: 'agents.read', authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest', 'mcp_tool', 'mcp_resource'], cacheScope: 'principal', pagination: 'none' }, {
			path: z.object({ teamId: z.string().min(1), sendId: z.string().min(1) }).strict(), query: z.object({ diagnostics: z.enum(['metadata', 'full']).optional() }).strict(), body: none, output: communicationSendReceiptSchema,
		}),
		topicsList: defineOperation({ operationId: 'communications.topics.list', description: 'List team discussion topics and active listeners.', rest: { method: 'GET', path: '/v1/teams/{teamId}/discussion-topics' }, parameters: 'treeseed.communications.topics.list.parameters/v1', capability: 'agents.read', authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest', 'cli', 'mcp_tool', 'mcp_resource'], cacheScope: 'principal', pagination: 'cursor' }, {
			path: z.object({ teamId: z.string().min(1) }).strict(), query: z.object({ status: z.enum(['active', 'archived']).optional(), limit: z.coerce.number().int().min(1).max(200).optional(), cursor: z.string().optional() }).strict(), body: none, output: communicationTopicPageSchema,
		}),
		topicsShow: defineOperation({ operationId: 'communications.topics.show', description: 'Show one discussion topic, streams, and listeners.', rest: { method: 'GET', path: '/v1/teams/{teamId}/discussion-topics/{channel}' }, parameters: 'treeseed.communications.topics.show.parameters/v1', capability: 'agents.read', authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest', 'cli', 'mcp_tool', 'mcp_resource'], cacheScope: 'principal', pagination: 'none' }, {
			path: z.object({ teamId: z.string().min(1), channel: z.string().min(1) }).strict(), query: empty, body: none, output: communicationTopicSchema,
		}),
		topicsTimeline: defineOperation({ operationId: 'communications.topics.timeline', description: 'Read the ordered durable timeline for a discussion topic.', rest: { method: 'GET', path: '/v1/teams/{teamId}/discussion-topics/{channel}/timeline' }, parameters: 'treeseed.communications.topics.timeline.parameters/v1', capability: 'agents.read', authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest', 'mcp_tool', 'mcp_resource'], cacheScope: 'principal', pagination: 'cursor' }, {
			path: z.object({ teamId: z.string().min(1), channel: z.string().min(1) }).strict(), query: z.object({ after: z.string().optional(), waitSeconds: z.coerce.number().int().min(0).max(30).optional(), limit: z.coerce.number().int().min(1).max(500).optional(), diagnostics: z.enum(['metadata', 'full']).optional() }).strict(), body: none, output: communicationTopicTimelineSchema,
		}),
		topicsSubscribe: defineOperation({ operationId: 'communications.topics.subscriptions.put', description: 'Subscribe an agent to a discussion topic.', rest: { method: 'PUT', path: '/v1/teams/{teamId}/discussion-topics/{channel}/subscriptions' }, parameters: 'treeseed.communications.topics.subscriptions.put.parameters/v1', capability: 'agents.execute', authentication: 'oauth', oauthScopes: ['treeseed:execution'], kind: 'mutation', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest', 'cli', 'mcp_tool'], cacheScope: 'none', pagination: 'none' }, {
			path: z.object({ teamId: z.string().min(1), channel: z.string().min(1) }).strict(), query: empty, body: communicationTopicSubscriptionRequestSchema, output: communicationTopicSubscriptionReceiptSchema,
		}),
		topicsUnsubscribe: defineOperation({ operationId: 'communications.topics.subscriptions.delete', description: 'Remove an agent subscription from a discussion topic.', rest: { method: 'DELETE', path: '/v1/teams/{teamId}/discussion-topics/{channel}/subscriptions' }, parameters: 'treeseed.communications.topics.subscriptions.delete.parameters/v1', capability: 'agents.execute', authentication: 'oauth', oauthScopes: ['treeseed:execution'], kind: 'mutation', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest', 'cli', 'mcp_tool'], cacheScope: 'none', pagination: 'none' }, {
			path: z.object({ teamId: z.string().min(1), channel: z.string().min(1) }).strict(), query: empty, body: communicationTopicSubscriptionRequestSchema, output: communicationTopicSubscriptionReceiptSchema,
		}),
	};
}

export function providerDiscussionResponseOperation() {
	return defineOperation({ operationId: 'providers.assignments.discussion.respond', description: 'Commit and settle an assignment-scoped discussion response.', rest: { method: 'POST', path: '/v1/provider/assignments/{assignmentId}/discussion-response' }, parameters: 'treeseed.providers.assignments.discussion.respond.parameters/v1', capability: 'providers.execute', authentication: 'provider', oauthScopes: [], kind: 'mutation', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest'], cacheScope: 'none', pagination: 'none' }, {
		path: z.object({ assignmentId: z.string().min(1) }).strict(), query: empty, body: providerDiscussionResponseRequestSchema, output: providerDiscussionResponseReceiptSchema,
	});
}

export function providerCommunicationLifecycleOperations() {
	return {
		notificationAcknowledge: defineOperation({ operationId: 'providers.assignments.communication.acknowledge', description: 'Acknowledge provider observation of an addressed communication mention.', rest: { method: 'POST', path: '/v1/provider/assignments/{assignmentId}/communication-acknowledgement' }, parameters: 'treeseed.providers.assignments.communication.acknowledge.parameters/v1', capability: 'providers.execute', authentication: 'provider', oauthScopes: [], kind: 'mutation', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest'], cacheScope: 'none', pagination: 'none' }, {
			path: z.object({ assignmentId: z.string().min(1) }).strict(), query: empty, body: providerCommunicationNotificationAcknowledgeRequestSchema, output: z.object({ assignmentId: z.string(), acknowledgedAt: z.string().datetime(), replayed: z.boolean() }).strict(),
		}),
		traceEvent: defineOperation({ operationId: 'providers.assignments.communication.trace.create', description: 'Append one provider-authored communication execution trace event.', rest: { method: 'POST', path: '/v1/provider/assignments/{assignmentId}/communication-trace-events' }, parameters: 'treeseed.providers.assignments.communication.trace.create.parameters/v1', capability: 'providers.execute', authentication: 'provider', oauthScopes: [], kind: 'mutation', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest'], cacheScope: 'none', pagination: 'none' }, {
			path: z.object({ assignmentId: z.string().min(1) }).strict(), query: empty, body: providerCommunicationTraceEventRequestSchema, output: z.object({ assignmentId: z.string(), sequence: z.number().int().nonnegative(), acceptedAt: z.string().datetime(), replayed: z.boolean() }).strict(),
		}),
	};
}
