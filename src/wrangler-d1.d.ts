import type { D1DatabaseLike, D1PreparedStatementLike } from './types/cloudflare.ts';
declare class WranglerD1PreparedStatement implements D1PreparedStatementLike {
    private readonly databaseName;
    private readonly cwd;
    private readonly persistTo?;
    private readonly query;
    private bindings;
    constructor(databaseName: string, cwd: string, persistTo?: string, query?: string);
    bind(...values: unknown[]): this;
    private execute;
    run(): Promise<any[]>;
    all<T = Record<string, unknown>>(): Promise<{
        results: T[];
    }>;
    first<T = Record<string, unknown>>(): Promise<T>;
    raw<T = unknown[]>(): Promise<T[]>;
}
export declare class WranglerD1Database implements D1DatabaseLike {
    private readonly databaseName;
    private readonly cwd;
    private readonly persistTo?;
    constructor(databaseName: string, cwd: string, persistTo?: string);
    prepare(query: string): WranglerD1PreparedStatement;
}
export {};
