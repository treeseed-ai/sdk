import type { TreeDxWorkspaceRequest } from './tree-dx-actor.ts';

export const TREE_DX_CHANGESET_CONTRACT = 'treedx.changeset/v1' as const;
export const ARTIFACT_REF_CONTRACT = 'treeseed.artifact-ref/v1' as const;

export interface ArtifactRef {
	contract: typeof ARTIFACT_REF_CONTRACT;
	kind: 'treedx-content' | 'repository-file' | 'r2-object' | 'verification-evidence' | 'provider-input' | 'provider-output' | 'citation' | 'source-commit';
	repositoryId?: string;
	workspaceId?: string;
	path?: string;
	commitSha?: string | null;
	objectKey?: string;
	sha256: string | null;
	byteLength?: number;
	mediaType?: string;
	visibility: 'private' | 'assignment' | 'project' | 'team' | 'public';
	assignmentId?: string;
	toolCallId?: string;
	eventId?: string;
	provenance?: Record<string, string>;
}

export interface TreeDxChangesetRequest extends TreeDxWorkspaceRequest {
	contract: typeof TREE_DX_CHANGESET_CONTRACT;
	baseCommitSha: string;
	baseRef: string;
	patch: string;
	patchSha256: string;
	idempotencyKey: string;
	expectedWorkspaceVersion?: string;
	expectedDestinationRefHead?: string;
}

export interface TreeDxChangesetFileReceipt {
	path: string;
	beforeSha256: string | null;
	afterSha256: string | null;
	byteLength: number;
}

export interface TreeDxChangesetReceipt {
	contract: typeof TREE_DX_CHANGESET_CONTRACT;
	repositoryId: string;
	workspaceId: string;
	baseRef: string;
	baseCommitSha: string;
	resultCommitSha: string | null;
	branch: string;
	changedPaths: string[];
	files: TreeDxChangesetFileReceipt[];
	patchSha256: string;
	idempotencyKey: string;
	idempotentReplay: boolean;
	workspaceVersion: string;
}
