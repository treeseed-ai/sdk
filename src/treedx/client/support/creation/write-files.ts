import { TreeDxClient } from '../../../support/client.ts';
import type { TreeDxWriteFilesRequest, TreeDxWriteFilesResult } from '../../../types.ts';

export function writeFilesMethod(this: TreeDxClient, input: TreeDxWriteFilesRequest): Promise<TreeDxWriteFilesResult> {
	const { workspaceId, files } = input;
	return this.request<TreeDxWriteFilesResult>(
		'PUT',
		`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/files/batch`,
		{ files },
		{ tokenRequired: true },
	);
}
