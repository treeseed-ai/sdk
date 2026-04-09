import type { SdkLeaseEntity, SdkLeaseReleaseRequest, SdkSearchRequest, SdkUpdateRequest } from '../sdk-types.ts';
import { SqliteStoreBase } from './helpers.ts';
export interface LeaseClaimInput {
    model: string;
    itemKey: string;
    claimedBy: string;
    leaseSeconds: number;
}
export declare class LeaseStore extends SqliteStoreBase {
    private usesEnvelopeTable;
    getByKey(key: string): Promise<SdkLeaseEntity>;
    search(request: SdkSearchRequest): Promise<SdkLeaseEntity[]>;
    tryClaim(input: LeaseClaimInput): Promise<`${string}-${string}-${string}-${string}-${string}`>;
    create(input: LeaseClaimInput): Promise<SdkLeaseEntity>;
    release(request: SdkLeaseReleaseRequest): Promise<void>;
    update(request: SdkUpdateRequest): Promise<SdkLeaseEntity>;
    releaseAll(): Promise<number>;
}
