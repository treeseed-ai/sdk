import type {
	ControlPlaneOperationBinding,
	ControlPlaneOperationBody,
	ControlPlaneOperationOutput,
	ControlPlaneOperationPath,
	ControlPlaneOperationQuery,
} from '../operator-contracts/control-plane-operation.ts';
import { CONTROL_PLANE_OPERATIONS } from '../operator-contracts/control-plane-operations.ts';
import type {
	ControlPlaneClient,
	ControlPlaneInvocation,
	ControlPlaneOperationCallOptions,
	ControlPlaneResponseEnvelope,
} from '../entrypoints/clients/control-plane-client.ts';

export const TREESEED_TREEDX_OPERATIONS = CONTROL_PLANE_OPERATIONS.treedx;

function flattenBindings(value: unknown, output = new Set<ControlPlaneOperationBinding<any, any, any, any>>()) {
	if (value && typeof value === 'object' && 'descriptor' in value && 'schema' in value) {
		output.add(value as ControlPlaneOperationBinding<any, any, any, any>);
	} else if (value && typeof value === 'object') {
		for (const child of Object.values(value)) flattenBindings(child, output);
	}
	return output;
}

const TREESEED_TREEDX_OPERATION_BINDINGS = flattenBindings(TREESEED_TREEDX_OPERATIONS);

type TreeDxProxyMethod<TOperation extends ControlPlaneOperationBinding<any, any, any, any>> = (
	input: ControlPlaneInvocation<ControlPlaneOperationPath<TOperation>, ControlPlaneOperationQuery<TOperation>, ControlPlaneOperationBody<TOperation>>,
	options?: ControlPlaneOperationCallOptions,
) => Promise<ControlPlaneResponseEnvelope<ControlPlaneOperationOutput<TOperation>>>;

export type TreeDxProxyGroups<TTree> = {
	readonly [TKey in keyof TTree]: TTree[TKey] extends ControlPlaneOperationBinding<any, any, any, any>
		? TreeDxProxyMethod<TTree[TKey]>
		: TreeDxProxyGroups<TTree[TKey]>;
};

function bindProxyGroups<TTree>(controlPlane: ControlPlaneClient, tree: TTree): TreeDxProxyGroups<TTree> {
	return Object.fromEntries(Object.entries(tree as Record<string, unknown>).map(([key, value]) => {
		if (value && typeof value === 'object' && 'descriptor' in value && 'schema' in value) {
			const operation = value as ControlPlaneOperationBinding<any, any, any, any>;
			return [key, (input: ControlPlaneInvocation<any, any, any>, options?: ControlPlaneOperationCallOptions) =>
				controlPlane.invoke(operation, input, options)];
		}
		return [key, bindProxyGroups(controlPlane, value)];
	})) as TreeDxProxyGroups<TTree>;
}

export class TreeSeedTreeDxClient {
	readonly operations = TREESEED_TREEDX_OPERATIONS;
	readonly proxy: TreeDxProxyGroups<typeof TREESEED_TREEDX_OPERATIONS>;

	constructor(readonly controlPlane: ControlPlaneClient) {
		this.proxy = bindProxyGroups(controlPlane, TREESEED_TREEDX_OPERATIONS);
	}

	async invoke<TOperation extends ControlPlaneOperationBinding<any, any, any, any>>(
		operation: TOperation,
		input: ControlPlaneInvocation<ControlPlaneOperationPath<TOperation>, ControlPlaneOperationQuery<TOperation>, ControlPlaneOperationBody<TOperation>>,
		options: ControlPlaneOperationCallOptions = {},
	): Promise<ControlPlaneResponseEnvelope<ControlPlaneOperationOutput<TOperation>>> {
		if (!TREESEED_TREEDX_OPERATION_BINDINGS.has(operation)) {
			throw new Error(`Operation ${operation.descriptor.operationId} is not part of the TreeSeed TreeDX proxy catalog.`);
		}
		return this.controlPlane.invoke(operation, input, options);
	}
}
