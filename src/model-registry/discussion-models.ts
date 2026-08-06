import path from 'node:path';
import type { SdkModelDefinition } from '../entrypoints/models/sdk-types.ts';
import { contentRoot, deriveFieldLists, field, graph } from './content-root.ts';

type DiscussionModelName = 'discussion' | 'discussion_message' | 'discussion_event';

function definition(input: {
	name: DiscussionModelName;
	aliases: string[];
	collection: string;
	entityType: string;
	fields: SdkModelDefinition['fields'];
	referenceFields?: NonNullable<SdkModelDefinition['graph']>['referenceFields'];
	pickField: string;
	repoRoot?: string;
}): SdkModelDefinition {
	return {
		name: input.name,
		aliases: input.aliases,
		storage: 'content',
		operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
		graph: graph({
			entityType: input.entityType,
			titleField: input.fields.title ? 'title' : 'id',
			enableSections: true,
			referenceFields: input.referenceFields ?? [],
		}),
		fields: input.fields,
		...deriveFieldLists(input.fields),
		pickField: input.pickField,
		contentCollection: input.collection,
		contentDir: path.join(contentRoot(input.repoRoot), input.collection),
	};
}

export function buildDiscussionModelRegistry(repoRoot?: string): Record<DiscussionModelName, SdkModelDefinition> {
	const discussionFields = {
		title: field('title', { filterable: true, sortable: true, contentKeys: ['title'], writeContentKey: 'title' }),
		topic: field('topic', { filterable: true, contentKeys: ['topic'], writeContentKey: 'topic' }),
		status: field('status', { filterable: true, contentKeys: ['status'], writeContentKey: 'status' }),
		team_id: field('team_id', { aliases: ['teamId'], filterable: true, contentKeys: ['team_id', 'teamId'], writeContentKey: 'team_id' }),
		project_id: field('project_id', { aliases: ['projectId'], filterable: true, contentKeys: ['project_id', 'projectId'], writeContentKey: 'project_id' }),
		participant_ids: field('participant_ids', { aliases: ['participantIds'], filterable: true, comparableAs: 'string_array', contentKeys: ['participant_ids', 'participantIds'], writeContentKey: 'participant_ids' }),
		agent_ids: field('agent_ids', { aliases: ['agentIds'], filterable: true, comparableAs: 'string_array', contentKeys: ['agent_ids', 'agentIds'], writeContentKey: 'agent_ids' }),
		created_at: field('created_at', { aliases: ['createdAt'], filterable: true, sortable: true, comparableAs: 'date', contentKeys: ['created_at', 'createdAt'], writeContentKey: 'created_at' }),
		updated_at: field('updated_at', { aliases: ['updatedAt'], filterable: true, sortable: true, comparableAs: 'date', contentKeys: ['updated_at', 'updatedAt'], writeContentKey: 'updated_at' }),
	};
	const messageFields = {
		title: field('title', { sortable: true, contentKeys: ['title'], writeContentKey: 'title' }),
		discussion_id: field('discussion_id', { aliases: ['discussionId'], filterable: true, contentKeys: ['discussion_id', 'discussionId'], writeContentKey: 'discussion_id' }),
		author_id: field('author_id', { aliases: ['authorId'], filterable: true, contentKeys: ['author_id', 'authorId'], writeContentKey: 'author_id' }),
		author_type: field('author_type', { aliases: ['authorType'], filterable: true, contentKeys: ['author_type', 'authorType'], writeContentKey: 'author_type' }),
		intent: field('intent', { filterable: true, contentKeys: ['intent'], writeContentKey: 'intent' }),
		reply_to: field('reply_to', { aliases: ['replyTo'], filterable: true, contentKeys: ['reply_to', 'replyTo'], writeContentKey: 'reply_to' }),
		mentioned_agents: field('mentioned_agents', { aliases: ['mentionedAgents'], filterable: true, comparableAs: 'string_array', contentKeys: ['mentioned_agents', 'mentionedAgents'], writeContentKey: 'mentioned_agents' }),
		file_refs: field('file_refs', { aliases: ['fileRefs'], contentKeys: ['file_refs', 'fileRefs'], writeContentKey: 'file_refs' }),
		created_at: field('created_at', { aliases: ['createdAt'], filterable: true, sortable: true, comparableAs: 'date', contentKeys: ['created_at', 'createdAt'], writeContentKey: 'created_at' }),
	};
	const eventFields = {
		title: field('title', { sortable: true, contentKeys: ['title'], writeContentKey: 'title' }),
		discussion_id: field('discussion_id', { aliases: ['discussionId'], filterable: true, contentKeys: ['discussion_id', 'discussionId'], writeContentKey: 'discussion_id' }),
		message_id: field('message_id', { aliases: ['messageId'], filterable: true, contentKeys: ['message_id', 'messageId'], writeContentKey: 'message_id' }),
		phase: field('phase', { filterable: true, contentKeys: ['phase'], writeContentKey: 'phase' }),
		sequence: field('sequence', { filterable: true, sortable: true, comparableAs: 'number', contentKeys: ['sequence'], writeContentKey: 'sequence' }),
		agent_id: field('agent_id', { aliases: ['agentId'], filterable: true, contentKeys: ['agent_id', 'agentId'], writeContentKey: 'agent_id' }),
		assignment_id: field('assignment_id', { aliases: ['assignmentId'], filterable: true, contentKeys: ['assignment_id', 'assignmentId'], writeContentKey: 'assignment_id' }),
		mode_run_id: field('mode_run_id', { aliases: ['modeRunId'], filterable: true, contentKeys: ['mode_run_id', 'modeRunId'], writeContentKey: 'mode_run_id' }),
		provider_id: field('provider_id', { aliases: ['providerId'], filterable: true, contentKeys: ['provider_id', 'providerId'], writeContentKey: 'provider_id' }),
		occurred_at: field('occurred_at', { aliases: ['occurredAt'], filterable: true, sortable: true, comparableAs: 'date', contentKeys: ['occurred_at', 'occurredAt'], writeContentKey: 'occurred_at' }),
		metrics: field('metrics', { contentKeys: ['metrics'], writeContentKey: 'metrics' }),
		refs: field('refs', { comparableAs: 'string_array', contentKeys: ['refs'], writeContentKey: 'refs' }),
	};
	return {
		discussion: definition({ name: 'discussion', aliases: ['discussions'], collection: 'discussions', entityType: 'Discussion', fields: discussionFields, pickField: 'updated_at', repoRoot }),
		discussion_message: definition({ name: 'discussion_message', aliases: ['discussion_messages'], collection: 'discussion-messages', entityType: 'DiscussionMessage', fields: messageFields, referenceFields: [{ field: 'discussion_id', edgeType: 'REFERENCES', targetModels: ['discussion'] }, { field: 'reply_to', edgeType: 'REFERENCES', targetModels: ['discussion_message'] }], pickField: 'created_at', repoRoot }),
		discussion_event: definition({ name: 'discussion_event', aliases: ['discussion_events'], collection: 'discussion-events', entityType: 'DiscussionEvent', fields: eventFields, referenceFields: [{ field: 'discussion_id', edgeType: 'REFERENCES', targetModels: ['discussion'] }, { field: 'message_id', edgeType: 'REFERENCES', targetModels: ['discussion_message'] }], pickField: 'occurred_at', repoRoot }),
	};
}
