import { z } from 'zod';
import { exactEntityReferenceSchema, leaseSchema } from '../../capacity/assignments/agent-execution.ts';
import { agentClassSchema } from '../../../validation/agent-definition-schema.ts';
import { uniqueArray } from '../../../../content/validation/schema-constraints.ts';

/** An exact governed registration, not mutable class metadata or an issued assignment. */
export const agentRegistrationSchema = z.object({
	schemaVersion: z.literal('treeseed.agent-registration/v1'), id: leaseSchema.shape.id, teamId: leaseSchema.shape.id,
	projectIds: uniqueArray(z.array(leaseSchema.shape.id).min(1)), agentClass: agentClassSchema,
	profileRef: exactEntityReferenceSchema, active: z.boolean(),
}).strict();
export type AgentRegistration = z.infer<typeof agentRegistrationSchema>;

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
