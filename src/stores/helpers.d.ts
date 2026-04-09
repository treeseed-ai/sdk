import type { D1DatabaseLike } from '../types/cloudflare.ts';
export type DatabaseRow = Record<string, unknown>;
export declare function nowIso(): string;
export declare function toSqlValue(value: unknown): string;
export declare class SqliteStoreBase {
    protected readonly db: D1DatabaseLike;
    constructor(db: D1DatabaseLike);
    protected selectAll(query: string): Promise<DatabaseRow[]>;
    protected selectFirst(query: string): Promise<DatabaseRow>;
    protected execute(query: string): Promise<void>;
    protected tableExists(tableName: string): Promise<boolean>;
}
