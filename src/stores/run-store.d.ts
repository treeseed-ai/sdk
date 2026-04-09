import type { SdkRecordRunRequest, SdkRunEntity, SdkSearchRequest, SdkUpdateRequest } from '../sdk-types.ts';
import { SqliteStoreBase } from './helpers.ts';
export declare function runFromRecord(row: Record<string, unknown>): SdkRunEntity;
export declare class RunStore extends SqliteStoreBase {
    private usesEnvelopeTable;
    getByKey(key: string): Promise<SdkRunEntity>;
    search(request: SdkSearchRequest): Promise<SdkRunEntity[]>;
    record(request: SdkRecordRunRequest): Promise<SdkRunEntity>;
    update(request: SdkUpdateRequest): Promise<SdkRunEntity>;
}
