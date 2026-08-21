import type { MarketClient } from '../entrypoints/clients/market-client.ts';
import { createCapacityAllocationSetMethod } from './capacity/allocations/creation/create-capacity-allocation-set.ts';
import { activateCapacityAllocationSetMethod } from './capacity/allocations/lifecycle/activate-capacity-allocation-set.ts';
import { supersedeCapacityAllocationSetMethod } from './capacity/allocations/updates/supersede-capacity-allocation-set.ts';

export function createInternalCapacityAllocationSet(client:MarketClient,teamId:string,body:Record<string,unknown>,idempotencyKey:string) {
	return createCapacityAllocationSetMethod.call(client,teamId,body,idempotencyKey);
}

export function activateInternalCapacityAllocationSet(client:MarketClient,teamId:string,allocationSetId:string,idempotencyKey:string) {
	return activateCapacityAllocationSetMethod.call(client,teamId,allocationSetId,idempotencyKey);
}

export function supersedeInternalCapacityAllocationSet(client:MarketClient,teamId:string,allocationSetId:string,body:Record<string,unknown>,idempotencyKey:string) {
	return supersedeCapacityAllocationSetMethod.call(client,teamId,allocationSetId,body,idempotencyKey);
}
