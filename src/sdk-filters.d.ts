import type { SdkContentEntry, SdkFilterCondition, SdkSortSpec } from './sdk-types.ts';
export declare function matchesFilter(entry: SdkContentEntry | Record<string, unknown>, filter: SdkFilterCondition): boolean;
export declare function applyFilters<T extends SdkContentEntry | Record<string, unknown>>(items: T[], filters?: SdkFilterCondition[]): T[];
export declare function applySort<T extends SdkContentEntry | Record<string, unknown>>(items: T[], sort?: SdkSortSpec[]): T[];
