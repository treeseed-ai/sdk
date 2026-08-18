import path from 'node:path';
import type { SdkModelDefinition } from '../entrypoints/models/sdk-types.ts';
import { citationsField,contentRoot,field,graph } from './content-root.ts';

export function buildKnowledgeModelRegistry(repoRoot?: string): Record<'book' | 'knowledge',SdkModelDefinition> {
	const root = contentRoot(repoRoot);
	return {
		book: {
			name:'book',aliases:['books'],storage:'content',operations:['get','read','search','follow','pick','create','update'],
			graph:graph({ entityType:'Book',titleField:'title',groupField:'group_ids',enableSections:true,referenceFields:[
				{ field:'related_books',edgeType:'RELATES_TO',targetModels:['book'],multiple:true },
				{ field:'editorial_core_note',edgeType:'GUIDED_BY',targetModels:['note'] },
			] }),
			fields:{
				schemaVersion:field('schemaVersion',{ aliases:['schema_version'],contentKeys:['schemaVersion','schema_version'],writeContentKey:'schemaVersion' }),
				id:field('id',{ filterable:true,contentKeys:['id'],writeContentKey:'id' }),
				title:field('title',{ filterable:true,sortable:true,contentKeys:['title'],writeContentKey:'title' }),
				description:field('description',{ contentKeys:['description'],writeContentKey:'description' }),
				summary:field('summary',{ contentKeys:['summary'],writeContentKey:'summary' }),
				status:field('status',{ filterable:true,contentKeys:['status'],writeContentKey:'status' }),
				visibility:field('visibility',{ filterable:true,contentKeys:['visibility'],writeContentKey:'visibility' }),citations:citationsField(),
				slug:field('slug',{ filterable:true,contentKeys:['slug'],writeContentKey:'slug' }),
				group_ids:field('group_ids',{ aliases:['groupIds'],filterable:true,comparableAs:'string_array',contentKeys:['group_ids','groupIds'],writeContentKey:'groupIds' }),
				audience:field('audience',{ comparableAs:'string_array',contentKeys:['audience'],writeContentKey:'audience' }),
				related_books:field('related_books',{ aliases:['relatedBookIds'],filterable:true,comparableAs:'string_array',contentKeys:['relatedBookIds','related_books'],writeContentKey:'relatedBookIds' }),
				editorial_core_note:field('editorial_core_note',{ aliases:['editorialCoreNoteId'],filterable:true,contentKeys:['editorialCoreNoteId','editorial_core_note'],writeContentKey:'editorialCoreNoteId' }),
				section_label:field('section_label',{ aliases:['sectionLabel'],filterable:true,contentKeys:['section_label','sectionLabel'],writeContentKey:'section_label' }),
				order:field('order',{ sortable:true,comparableAs:'number',contentKeys:['order'],writeContentKey:'order' }),
				updated_at:field('updated_at',{ aliases:['updated','updatedAt'],sortable:true,comparableAs:'date',contentKeys:['updated_at','updated','updatedAt'],writeContentKey:'updated_at' }),
			},filterableFields:['title','slug','group_ids','section_label','related_books','editorial_core_note'],sortableFields:['title','order','updated_at'],pickField:'order',contentCollection:'books',contentDir:path.join(root,'books'),
		},
		knowledge: {
			name:'knowledge',aliases:['knowledge-base','docs'],storage:'content',operations:['get','read','search','follow','pick','create','update'],
			graph:graph({ entityType:'Knowledge',titleField:'title',groupField:'group_ids',enableSections:true,referenceFields:[
				{ field:'book_id',edgeType:'BELONGS_TO',targetModels:['book'] },{ field:'parent',edgeType:'BELONGS_TO',targetModels:['knowledge'] },
				{ field:'related_knowledge',edgeType:'RELATES_TO',targetModels:['knowledge'],multiple:true },{ field:'related_books',edgeType:'RELATES_TO',targetModels:['book'],multiple:true },
				{ field:'related_notes',edgeType:'REFERENCES',targetModels:['note'],multiple:true },{ field:'related_questions',edgeType:'REFERENCES',targetModels:['question'],multiple:true },
				{ field:'related_objectives',edgeType:'REFERENCES',targetModels:['objective'],multiple:true },{ field:'related_proposals',edgeType:'REFERENCES',targetModels:['proposal'],multiple:true },
				{ field:'related_decisions',edgeType:'REFERENCES',targetModels:['decision'],multiple:true },
			] }),
			fields:{
				schemaVersion:field('schemaVersion',{ aliases:['schema_version'],contentKeys:['schemaVersion','schema_version'],writeContentKey:'schemaVersion' }),
				id:field('id',{ filterable:true,contentKeys:['id'],writeContentKey:'id' }),
				title:field('title',{ filterable:true,sortable:true,contentKeys:['title'],writeContentKey:'title' }),
				description:field('description',{ contentKeys:['description'],writeContentKey:'description' }),
				summary:field('summary',{ contentKeys:['summary'],writeContentKey:'summary' }),
				status:field('status',{ filterable:true,contentKeys:['status'],writeContentKey:'status' }),
				visibility:field('visibility',{ filterable:true,contentKeys:['visibility'],writeContentKey:'visibility' }),
				order:field('order',{ sortable:true,comparableAs:'number',contentKeys:['order'],writeContentKey:'order' }),
				book_id:field('book_id',{ aliases:['bookId'],filterable:true,contentKeys:['bookId','book_id'],writeContentKey:'bookId' }),citations:citationsField(),
				group_ids:field('group_ids',{ aliases:['groupIds'],filterable:true,comparableAs:'string_array',contentKeys:['group_ids','groupIds'],writeContentKey:'groupIds' }),parent:field('parent',{ aliases:['parentId'],filterable:true,contentKeys:['parentId','parent'],writeContentKey:'parentId' }),
				related_knowledge:field('related_knowledge',{ aliases:['relatedKnowledgeIds'],filterable:true,comparableAs:'string_array',contentKeys:['relatedKnowledgeIds','related_knowledge'],writeContentKey:'relatedKnowledgeIds' }),related_books:field('related_books',{ aliases:['relatedBookIds'],filterable:true,comparableAs:'string_array',contentKeys:['relatedBookIds','related_books'],writeContentKey:'relatedBookIds' }),
				related_notes:field('related_notes',{ aliases:['relatedNoteIds'],filterable:true,comparableAs:'string_array',contentKeys:['relatedNoteIds','related_notes'],writeContentKey:'relatedNoteIds' }),related_questions:field('related_questions',{ aliases:['relatedQuestionIds'],filterable:true,comparableAs:'string_array',contentKeys:['relatedQuestionIds','related_questions'],writeContentKey:'relatedQuestionIds' }),
				related_objectives:field('related_objectives',{ aliases:['relatedObjectiveIds'],filterable:true,comparableAs:'string_array',contentKeys:['relatedObjectiveIds','related_objectives'],writeContentKey:'relatedObjectiveIds' }),related_proposals:field('related_proposals',{ aliases:['relatedProposalIds'],filterable:true,comparableAs:'string_array',contentKeys:['relatedProposalIds','related_proposals'],writeContentKey:'relatedProposalIds' }),
				related_decisions:field('related_decisions',{ aliases:['relatedDecisionIds'],filterable:true,comparableAs:'string_array',contentKeys:['relatedDecisionIds','related_decisions'],writeContentKey:'relatedDecisionIds' }),guarantees:field('guarantees',{ aliases:['guaranteeIds'],filterable:true,comparableAs:'string_array',contentKeys:['guaranteeIds','guarantees'],writeContentKey:'guaranteeIds' }),
				updated_at:field('updated_at',{ aliases:['updated','updatedAt'],filterable:true,sortable:true,comparableAs:'date',contentKeys:['updated_at','updated','updatedAt'],writeContentKey:'updated_at' }),slug:field('slug',{ filterable:true,contentKeys:['slug'],writeContentKey:'slug' }),
			},filterableFields:['title','book_id','group_ids','updated_at','slug','parent','related_knowledge','related_books','related_notes','related_questions','related_objectives','related_proposals','related_decisions','guarantees'],sortableFields:['title','updated_at'],pickField:'updated_at',contentCollection:'docs',contentDir:path.join(root,'knowledge'),
		},
	};
}
