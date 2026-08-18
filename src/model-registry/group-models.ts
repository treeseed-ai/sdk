import path from 'node:path';
import type { SdkModelDefinition } from '../entrypoints/models/sdk-types.ts';
import { contentRoot, deriveFieldLists, field, graph } from './content-root.ts';

export function buildGroupModelRegistry(repoRoot?: string): Record<'group' | 'group_edge', SdkModelDefinition> {
	const root = contentRoot(repoRoot);
	const groupFields = {
		id: field('id', { filterable: true, sortable: true, contentKeys: ['id'], writeContentKey: 'id' }),
		slug: field('slug', { filterable: true, sortable: true, contentKeys: ['slug'], writeContentKey: 'slug' }),
		name: field('name', { filterable: true, sortable: true, contentKeys: ['name'], writeContentKey: 'name' }),
		classification: field('classification', { filterable: true, contentKeys: ['classification'], writeContentKey: 'classification' }),
		aliases: field('aliases', { filterable: true, comparableAs: 'string_array', contentKeys: ['aliases'], writeContentKey: 'aliases' }),
		status: field('status', { filterable: true, contentKeys: ['status'], writeContentKey: 'status' }),
	};
	const edgeFields = {
		id: field('id', { filterable: true, contentKeys: ['id'], writeContentKey: 'id' }),
		from_group_id: field('from_group_id', { aliases: ['fromGroupId'], filterable: true, contentKeys: ['from_group_id', 'fromGroupId'], writeContentKey: 'fromGroupId' }),
		to_group_id: field('to_group_id', { aliases: ['toGroupId'], filterable: true, contentKeys: ['to_group_id', 'toGroupId'], writeContentKey: 'toGroupId' }),
		predicate: field('predicate', { filterable: true, contentKeys: ['predicate'], writeContentKey: 'predicate' }),
		propagates_membership: field('propagates_membership', { aliases: ['propagatesMembership'], filterable: true, comparableAs: 'boolean', contentKeys: ['propagates_membership', 'propagatesMembership'], writeContentKey: 'propagatesMembership' }),
	};
	return {
		group: { name: 'group', aliases: ['groups'], storage: 'content', operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			graph: graph({ entityType: 'Group', titleField: 'name', enableSections: true }), fields: groupFields, ...deriveFieldLists(groupFields), pickField: 'name', contentCollection: 'groups', contentDir: path.join(root, 'groups') },
		group_edge: { name: 'group_edge', aliases: ['group_edges'], storage: 'content', operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			graph: graph({ entityType: 'GroupEdge', titleField: 'id', enableSections: false, referenceFields: [
				{ field: 'from_group_id', edgeType: 'GROUP_SOURCE', targetModels: ['group'] }, { field: 'to_group_id', edgeType: 'GROUP_TARGET', targetModels: ['group'] },
			] }), fields: edgeFields, ...deriveFieldLists(edgeFields), pickField: 'id', contentCollection: 'group-edges', contentDir: path.join(root, 'group-edges') },
	};
}
