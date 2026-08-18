import { TreeDxClient } from '../../../support/client.ts';
import type { TreeDxChangesetReceipt,TreeDxChangesetRequest } from '../../../types.ts';

export function applyChangesetMethod(this: TreeDxClient, input: TreeDxChangesetRequest): Promise<TreeDxChangesetReceipt> {
	const { workspaceId, ...body } = input;
	return this.request<TreeDxChangesetReceipt>('POST', `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/changesets`, body, {
		tokenRequired: true,
		gzipThresholdBytes: 1_024,
	});
}
