import path from 'node:path';
import type { SdkBuiltinModelName,SdkModelDefinition } from '../entrypoints/models/sdk-types.ts';
import { contentRoot,deriveFieldLists,field,graph } from './content-root.ts';

type OperationalModelName = Extract<SdkBuiltinModelName,
	'agent_context_query'|'agent_context_query_set'|'agent_instruction_template'|'discussion_topic'|
	'assignment_plan'|'assignment_status'|'assignment_summary'|'agent_evaluation'>;

function model(input: {
	name: OperationalModelName;collection: string;entityType: string;
	fields: SdkModelDefinition['fields'];aliases:string[];references?: NonNullable<SdkModelDefinition['graph']>['referenceFields'];repoRoot?: string;
}): SdkModelDefinition {
	return {
		name:input.name,aliases:input.aliases,storage:'content',
		operations:['get','read','search','follow','pick','create','update'],
		graph:graph({ entityType:input.entityType,titleField:'title',enableSections:true,referenceFields:input.references ?? [] }),
		fields:input.fields,...deriveFieldLists(input.fields),pickField:input.fields.updated_at ? 'updated_at' : 'title',
		contentCollection:input.collection,contentDir:path.join(contentRoot(input.repoRoot),input.collection),
	};
}

const title = () => field('title',{ filterable:true,sortable:true,contentKeys:['title'],writeContentKey:'title' });
const id = () => field('id',{ filterable:true,contentKeys:['id'],writeContentKey:'id' });
const ref = (key: string,alias: string) => field(key,{ aliases:[alias],filterable:true,contentKeys:[key,alias],writeContentKey:alias });
const refs = (key: string,alias: string) => field(key,{ aliases:[alias],filterable:true,comparableAs:'string_array',contentKeys:[key,alias],writeContentKey:alias });
const updated = () => field('updated_at',{ aliases:['updatedAt'],filterable:true,sortable:true,comparableAs:'date',contentKeys:['updated_at','updatedAt'],writeContentKey:'updatedAt' });
const data = (key: string,alias = key) => field(key,{ aliases:alias === key ? [] : [alias],contentKeys:[key,alias],writeContentKey:alias });

export function buildAgentOperationalModelRegistry(repoRoot?: string): Record<OperationalModelName,SdkModelDefinition> {
	const lifecycle = { id:id(),title:title(),status:field('status',{ filterable:true,contentKeys:['status'],writeContentKey:'status' }),team_id:ref('team_id','teamId'),project_id:ref('project_id','projectId'),workday_id:ref('workday_id','workdayId'),assignment_id:ref('assignment_id','assignmentId'),updated_at:updated() };
	return {
		agent_context_query:model({ name:'agent_context_query',aliases:['agent_context_queries'],collection:'agent-context-queries',entityType:'AgentContextQuery',repoRoot,fields:{ id:id(),title:title(),description:data('description'),revision:data('revision'),maturity:data('maturity'),purpose:data('purpose'),query:data('query'),target:data('target'),scope:data('scope'),code_scopes:data('code_scopes','codeScopes'),relations:refs('relations','relations'),depth:data('depth'),result_limit:data('result_limit','resultLimit'),context_budget:data('context_budget','contextBudget'),token_budget:data('token_budget','tokenBudget'),format:data('format'),filters:data('filters'),required:data('required') } }),
		agent_context_query_set:model({ name:'agent_context_query_set',aliases:['agent_context_query_sets'],collection:'agent-context-query-sets',entityType:'AgentContextQuerySet',repoRoot,fields:{ id:id(),title:title(),description:data('description'),revision:data('revision'),query_refs:refs('query_refs','queryRefs'),merge_policy:data('merge_policy','mergePolicy') },references:[{ field:'query_refs',edgeType:'REFERENCES',targetModels:['agent_context_query'],multiple:true }] }),
		agent_instruction_template:model({ name:'agent_instruction_template',aliases:['agent_instruction_templates'],collection:'agent-instruction-templates',entityType:'AgentInstructionTemplate',repoRoot,fields:{ id:id(),title:title(),description:data('description'),revision:data('revision'),kind:data('kind'),instructions:data('instructions'),output_skeleton:data('output_skeleton','outputSkeleton'),variables:refs('variables','variables'),applies_to_profiles:refs('applies_to_profiles','appliesToProfiles') } }),
		discussion_topic:model({ name:'discussion_topic',aliases:['discussion_topics'],collection:'discussion-topics',entityType:'DiscussionTopic',repoRoot,fields:{ id:id(),title:title(),description:data('description'),slug:field('slug',{ filterable:true,contentKeys:['slug'],writeContentKey:'slug' }),group_ids:refs('group_ids','groupIds'),parent_topic_id:ref('parent_topic_id','parentTopicId'),status:field('status',{ filterable:true,contentKeys:['status'],writeContentKey:'status' }) },references:[{ field:'parent_topic_id',edgeType:'PARENT_OF',targetModels:['discussion_topic'] }] }),
		assignment_plan:model({ name:'assignment_plan',aliases:['assignment_plans'],collection:'assignment-plans',entityType:'AssignmentPlan',repoRoot,fields:{ ...lifecycle,description:data('description'),created_at:data('created_at','createdAt'),revision:data('revision'),objective:data('objective'),completed:data('completed'),remaining:data('remaining'),risks:data('risks'),resume_state:data('resume_state','resumeState'),decision_id:ref('decision_id','decisionId'),capacity_plan_id:ref('capacity_plan_id','capacityPlanId') } }),
		assignment_status:model({ name:'assignment_status',aliases:['assignment_statuses'],collection:'assignment-statuses',entityType:'AssignmentStatus',repoRoot,fields:{ ...lifecycle,description:data('description'),created_at:data('created_at','createdAt'),sequence:data('sequence'),previous_status_ref:data('previous_status_ref','previousStatusRef'),phase:field('phase',{ filterable:true,contentKeys:['phase'],writeContentKey:'phase' }),reason:data('reason'),progress:data('progress') } }),
		assignment_summary:model({ name:'assignment_summary',aliases:['assignment_summaries'],collection:'assignment-summaries',entityType:'AssignmentSummary',repoRoot,fields:{ ...lifecycle,description:data('description'),created_at:data('created_at','createdAt'),summary:data('summary'),lessons:data('lessons'),performance:data('performance'),blockers:data('blockers'),resume_state:data('resume_state','resumeState'),artifact_refs:refs('artifact_refs','artifactRefs'),verification_refs:refs('verification_refs','verificationRefs') } }),
		agent_evaluation:model({ name:'agent_evaluation',aliases:['agent_evaluations'],collection:'agent-evaluations',entityType:'AgentEvaluation',repoRoot,fields:{ ...lifecycle,description:data('description'),created_at:data('created_at','createdAt'),agent_id:ref('agent_id','agentId'),agent_definition_ref:data('agent_definition_ref','agentDefinitionRef'),activity_profile:data('activity_profile','activityProfile'),context_query_refs:data('context_query_refs','contextQueryRefs'),context_query_set_refs:data('context_query_set_refs','contextQuerySetRefs'),instruction_template_refs:data('instruction_template_refs','instructionTemplateRefs'),evaluator_id:ref('evaluator_id','evaluatorId'),outcome:field('outcome',{ filterable:true,contentKeys:['outcome'],writeContentKey:'outcome' }),score:data('score'),criteria:data('criteria') },references:[{ field:'agent_id',edgeType:'REFERENCES',targetModels:['agent'] }] }),
	};
}
