import { firstPayload,TreeDxClient } from "../../../support/client.ts";
import type { TreeDxRegisterRepositoryRequest,TreeDxRepository } from "../../../types.ts";
export function registerRepositoryMethod(this: TreeDxClient, input: TreeDxRegisterRepositoryRequest): Promise<TreeDxRepository> {
    return this.request<Record<string, unknown>>('POST', '/api/v1/repos/register', input, { tokenRequired: true })
        .then((payload) => firstPayload<TreeDxRepository>(payload, ['repo', 'repository']));
}
