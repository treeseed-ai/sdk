export type ProjectAgentClassStatus = 'active' | 'paused' | 'archived';

export interface ProjectAgentClass {
	id: string;
	teamId: string;
	projectId: string;
	slug: string;
	name: string;
	status: ProjectAgentClassStatus;
	handlerRefs: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}
