import type { KnowledgeVisibility } from './contracts.ts';

export const KNOWLEDGE_PUBLICATION_SCHEMA_VERSION = 'treeseed.knowledge-publication/v1' as const;

export interface KnowledgePublicationObjectPointer {
	objectKey: string;
	sha256: string;
	byteSize: number;
}

export interface KnowledgePublicationProject {
	teamId: string;
	projectId: string;
	repositoryId: string;
	ref: string;
	commitSha: string;
	graphRevision: string;
	contentDigest: string;
}

export interface KnowledgePublicationEntry {
	kind: 'book' | 'page';
	id: string;
	bookId?: string;
	visibility: KnowledgeVisibility;
	status: 'published' | 'archived';
	projectId: string;
	sourcePath: string;
	content: KnowledgePublicationObjectPointer;
}

export interface KnowledgePublicationManifest {
	schemaVersion: typeof KNOWLEDGE_PUBLICATION_SCHEMA_VERSION;
	teamId: string;
	revision: string;
	generatedAt: string;
	previousRevision?: string;
	sourceClosure: string;
	projects: KnowledgePublicationProject[];
	entries: KnowledgePublicationEntry[];
	indexes: Record<KnowledgeVisibility, string[]>;
	digest: string;
}

const visibilityKeys: KnowledgeVisibility[] = ['public', 'authenticated', 'team', 'project', 'admin'];
const text = (value: unknown, label: string) => {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid knowledge publication ${label}.`);
	return value.trim();
};

export function parseKnowledgePublicationManifest(value: unknown): KnowledgePublicationManifest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid knowledge publication manifest.');
	const input = value as Record<string, any>;
	if (input.schemaVersion !== KNOWLEDGE_PUBLICATION_SCHEMA_VERSION) throw new Error('Unsupported knowledge publication schema.');
	const projects = Array.isArray(input.projects) ? input.projects : [];
	const entries = Array.isArray(input.entries) ? input.entries : [];
	const indexes = input.indexes && typeof input.indexes === 'object' ? input.indexes : {};
	for (const key of visibilityKeys) if (!Array.isArray(indexes[key])) throw new Error(`Knowledge publication index ${key} is missing.`);
	for (const entry of entries) {
		if (!['book', 'page'].includes(entry?.kind) || !visibilityKeys.includes(entry?.visibility)
			|| !['published', 'archived'].includes(entry?.status) || !entry?.content) throw new Error('Invalid knowledge publication entry.');
		text(entry.id, 'entry id'); text(entry.projectId, 'entry project'); text(entry.sourcePath, 'entry path');
		text(entry.content.objectKey, 'object key'); text(entry.content.sha256, 'object digest');
	}
	return {
		schemaVersion: KNOWLEDGE_PUBLICATION_SCHEMA_VERSION,
		teamId: text(input.teamId, 'team'), revision: text(input.revision, 'revision'),
		generatedAt: text(input.generatedAt, 'generated time'), previousRevision: input.previousRevision ? text(input.previousRevision, 'previous revision') : undefined,
		sourceClosure: text(input.sourceClosure, 'source closure'), projects, entries,
		indexes: Object.fromEntries(visibilityKeys.map((key) => [key, [...new Set(indexes[key].map(String))].sort()])) as Record<KnowledgeVisibility, string[]>,
		digest: text(input.digest, 'digest'),
	};
}
