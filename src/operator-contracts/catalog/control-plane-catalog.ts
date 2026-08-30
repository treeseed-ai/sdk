import type { ControlPlaneOperationBinding, ControlPlaneOperationDescriptor } from '../control-plane-operation.ts';

export function flattenControlPlaneOperations(
	value: unknown,
	output: ControlPlaneOperationBinding<any, any, any, any>[] = [],
) {
	if (value && typeof value === 'object' && 'descriptor' in value && 'schema' in value) {
		output.push(value as ControlPlaneOperationBinding<any, any, any, any>);
	} else if (value && typeof value === 'object') {
		for (const child of Object.values(value)) flattenControlPlaneOperations(child, output);
	}
	return output;
}

export function buildControlPlaneCatalog(operations: readonly ControlPlaneOperationBinding<any, any, any, any>[]) {
	return Object.freeze({
		schemaVersion: 'treeseed.control-plane-catalog/v1' as const,
		operations: operations.map((operation) => operation.descriptor satisfies ControlPlaneOperationDescriptor),
	});
}
