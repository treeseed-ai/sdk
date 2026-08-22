export type ContentAction =
	| 'describe'
	| 'query'
	| 'read'
	| 'create'
	| 'update'
	| 'link'
	| 'validate'
	| 'commit';

export type ContentModel =
	| 'page'
	| 'note'
	| 'question'
	| 'proposal'
	| 'decision'
	| 'book'
	| 'knowledge'
	| 'objective'
	| 'person'
	| 'agent'
	| 'discussion'
	| 'discussion_message'
	| 'discussion_event'
	| 'group'
	| 'group_edge'
	| 'agent_context_query'
	| 'agent_context_query_set'
	| 'agent_instruction_template'
	| 'discussion_topic'
	| 'assignment_plan'
	| 'assignment_status'
	| 'assignment_summary'
	| 'agent_evaluation';

export interface ContentReference {
	model: ContentModel;
	collection: string;
	slug: string;
	id?: string;
	path?: string;
	href?: string;
	subjectId?: string;
	subjectField?: string;
}
