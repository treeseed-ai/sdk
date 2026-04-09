import type { SdkCursorEntity, SdkCursorRequest, SdkGetCursorRequest, SdkSearchRequest, SdkUpdateRequest } from '../sdk-types.ts';
import { SqliteStoreBase } from './helpers.ts';
export declare class CursorStore extends SqliteStoreBase {
    private usesEnvelopeTable;
    getByKey(key: string): Promise<SdkCursorEntity>;
    get(request: SdkGetCursorRequest): Promise<string>;
    search(request: SdkSearchRequest): Promise<SdkCursorEntity[]>;
    upsert(request: SdkCursorRequest): Promise<void>;
    update(request: SdkUpdateRequest): Promise<SdkCursorEntity>;
}
