import type { SdkAckMessageRequest, SdkClaimMessageRequest, SdkCreateMessageRequest, SdkMessageEntity, SdkSearchRequest, SdkUpdateRequest } from '../sdk-types.ts';
import { SqliteStoreBase, type DatabaseRow } from './helpers.ts';
export declare function messageFromRow(row: DatabaseRow): SdkMessageEntity;
export declare class MessageStore extends SqliteStoreBase {
    private usesEnvelopeTable;
    getById(id: number): Promise<SdkMessageEntity>;
    search(request: SdkSearchRequest): Promise<SdkMessageEntity[]>;
    claim(request: SdkClaimMessageRequest): Promise<SdkMessageEntity>;
    ack(request: SdkAckMessageRequest): Promise<void>;
    create(request: SdkCreateMessageRequest): Promise<SdkMessageEntity>;
    update(request: SdkUpdateRequest): Promise<SdkMessageEntity>;
}
