import type { SdkMutationRequest, SdkSearchRequest, SdkSubscriptionEntity, SdkUpdateRequest } from '../sdk-types.ts';
import { SqliteStoreBase } from './helpers.ts';
export declare class SubscriptionStore extends SqliteStoreBase {
    private usesEnvelopeTable;
    getByKey(key: string): Promise<SdkSubscriptionEntity>;
    search(request: SdkSearchRequest): Promise<SdkSubscriptionEntity[]>;
    create(request: SdkMutationRequest): Promise<SdkSubscriptionEntity>;
    update(request: SdkUpdateRequest): Promise<SdkSubscriptionEntity>;
}
