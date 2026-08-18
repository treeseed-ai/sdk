import { firstPayload,TreeDxClient } from '../../../../support/client.ts';
import type { TreeDxWorkspaceAbandonResult } from '../../../../types.ts';

export function abandonWorkspaceMethod(this: TreeDxClient, workspaceId: string,
	expectedHead: string): Promise<TreeDxWorkspaceAbandonResult> {
	return this.request<Record<string, unknown>>('POST',
		`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/abandon`, { expectedHead }, { tokenRequired: true })
		.then((payload) => firstPayload<TreeDxWorkspaceAbandonResult>(payload, ['payload']));
}
