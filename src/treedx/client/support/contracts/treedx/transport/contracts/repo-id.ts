import { TreeDxClient } from "../../../../../../support/client.ts";
import { TreeDxApiError } from "../../../../../../support/errors.ts";
export function repoIdMethod(this: TreeDxClient, inputRepoId?: string) {
    const repoId = inputRepoId ?? this.defaultRepoId;
    if (!repoId) {
        throw new TreeDxApiError('TreeDX repository ID is required.', {
            status: 400,
            code: 'missing_repo_id',
        });
    }
    return repoId;
}
