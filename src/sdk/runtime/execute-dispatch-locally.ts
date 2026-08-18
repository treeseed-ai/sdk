import { resolveModelDefinition } from "../../entrypoints/models/model-registry.ts";
import { executeSdkOperation } from "../../entrypoints/models/sdk-dispatch.ts";
import type { SdkDispatchRequest,SdkGetRequest,SdkSearchRequest } from "../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../entrypoints/models/sdk.ts";
import { OperationsSdk } from "../../operations/runtime/runtime.ts";
import { MissingTreeDxContentBackend } from "../../treedx/repositories/treedx-backends.ts";
export async function executeDispatchLocallyMethod(this: AgentSdk, request: SdkDispatchRequest) {
    const namespace = request.namespace ?? 'sdk';
    if (namespace === 'workflow') {
        const operations = new OperationsSdk();
        return operations.execute({
            operationName: request.operation,
            input: request.input ?? {},
        }, {
            cwd: this.repoRoot,
            env: process.env,
            transport: 'sdk',
            // SDK dispatch returns structured output to its caller. Library-owned
            // workflow progress must never write to process stdout, which may be
            // carrying a framed protocol such as MCP stdio.
            write: () => undefined,
        });
    }
    if (this.content instanceof MissingTreeDxContentBackend) {
        const input = (request.input ?? {}) as SdkGetRequest & SdkSearchRequest;
        if (request.operation === 'read' || request.operation === 'get') {
            const definition = resolveModelDefinition(input.model, this.models);
            const payload = await this.localContentStore.get({
                ...input,
                model: definition.name,
            });
            return this.envelope(definition.name, request.operation === 'read' ? 'read' : 'get', payload);
        }
        if (request.operation === 'search') {
            const definition = resolveModelDefinition(input.model, this.models);
            const payload = await this.localContentStore.search({
                ...input,
                model: definition.name,
            });
            return this.envelope(definition.name, 'search', payload, {
                count: payload.length,
            });
        }
    }
    return executeSdkOperation(this, request.operation, request.input ?? {});
}
