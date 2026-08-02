import { firstPayload,TreeDxClient } from '../../../support/client.ts';
import type { TreeDxRef } from '../../../types.ts';

export function listRepositoryRefsMethod(this: TreeDxClient, repoId?: string): Promise<TreeDxRef[]> {
	return this.request<Record<string, unknown>>('GET',
		`/api/v1/repos/${encodeURIComponent(this.repoId(repoId))}/refs`, undefined, { tokenRequired: true })
		.then((payload) => firstPayload<TreeDxRef[]>(payload, ['refs']));
}
