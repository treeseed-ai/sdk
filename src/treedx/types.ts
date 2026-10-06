import { z } from 'zod';
import { assignmentReferenceSchema, exactEntityReferenceSchema, leaseSchema } from '../agent-capacity/contracts/capacity/assignments/agent-execution.ts';

const identifier = leaseSchema.shape.id, timestamp = leaseSchema.shape.acquiredAt;
const commit = assignmentReferenceSchema.options[0].shape.commit;

/** TreeSeed's governed service custody records, not product-neutral TreeDX models. */
export const treeDxWorkspaceSchema = z.object({
	schemaVersion: z.literal('treeseed.treedx-workspace/v1'), id: identifier, teamId: identifier,
	projectId: identifier, repository: z.string().min(1), baseCommit: commit, headCommit: commit,
	assignmentId: identifier, status: z.enum(['open', 'submitted', 'accepted', 'rejected', 'abandoned']),
	createdAt: timestamp, submittedAt: timestamp.optional(), closedAt: timestamp.optional(),
}).strict();
export const treeDxWorkspaceReviewSchema = z.object({
	schemaVersion: z.literal('treeseed.treedx-workspace-review/v1'), id: identifier, workspaceId: identifier,
	candidateCommit: commit, decisionRef: exactEntityReferenceSchema, status: z.enum(['approved', 'request-changes']), decidedAt: timestamp,
}).strict();
export const treeDxPublicationReceiptSchema = z.object({
	schemaVersion: z.literal('treeseed.treedx-publication-receipt/v1'), id: identifier, projectId: identifier,
	repository: z.string().min(1), sourceCommit: commit, publishedCommit: commit, destination: z.string().min(1),
	url: z.string().url().optional(), decisionRef: exactEntityReferenceSchema, publishedAt: timestamp,
}).strict();
export type TreeDxWorkspaceRecord = z.infer<typeof treeDxWorkspaceSchema>;
export type TreeDxWorkspaceReviewRecord = z.infer<typeof treeDxWorkspaceReviewSchema>;
export type TreeDxPublicationReceipt = z.infer<typeof treeDxPublicationReceiptSchema>;

export type {
	TreeDxApiErrorPayload,
	TreeDxCursor,
	TreeDxJson,
	TreeDxPage,
	TreeDxRecord,
} from '@treeseed/treedx/treedx/types';

export interface TreeSeedTreeDxResourceLink {
	type: 'resource_link';
	uri: `treeseed://dx/projects/${string}/${string}`;
	name: string;
	mimeType?: string;
	expiresAt?: string;
}
