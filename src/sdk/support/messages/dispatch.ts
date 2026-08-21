import { RemoteClient,RemoteDispatchClient } from "../../../entrypoints/clients/remote.ts";
import { findDispatchCapability } from "../../../entrypoints/dispatch/dispatch.ts";
import type { SdkDispatchRequest,SdkDispatchResult } from "../../../entrypoints/models/sdk-types.ts";
import { AgentSdk } from "../../../entrypoints/models/sdk.ts";
export async function dispatchMethod(this: AgentSdk, request: SdkDispatchRequest): Promise<SdkDispatchResult> {
    const namespace = request.namespace ?? 'sdk';
    const capability = findDispatchCapability(namespace, request.operation);
    if (!capability) {
        throw new Error(`Unknown dispatch operation "${namespace}:${request.operation}".`);
    }
    const preferredMode = request.preferredMode ?? this.dispatchConfig?.policy ?? capability.defaultDispatchMode;
    const dispatchConfig = this.dispatchConfig;
    if (!dispatchConfig && preferredMode === 'remote_only') {
        throw new Error(`Dispatch for "${namespace}:${request.operation}" requires a remote market configuration.`);
    }
    const shouldStayLocal = capability.executionClass === 'local_only'
        || !dispatchConfig
        || preferredMode === 'prefer_local';
    if (shouldStayLocal) {
        return {
            ok: true,
            mode: 'inline',
            namespace,
            operation: request.operation,
            target: 'local',
            capability,
            payload: await this.executeDispatchLocally({ ...request, namespace }),
        };
    }
    const token = await this.resolveDispatchToken(dispatchConfig.credentialSource);
    const client = new RemoteDispatchClient(new RemoteClient({
        hosts: [{ id: 'server', baseUrl: dispatchConfig.controlPlaneBaseUrl }],
        activeHostId: 'market',
        auth: token ? { accessToken: token } : undefined,
    }, {
        fetchImpl: dispatchConfig.fetchImpl,
    }));
    return client.dispatch(dispatchConfig.projectId, {
        ...request,
        namespace,
        preferredMode,
    });
}
