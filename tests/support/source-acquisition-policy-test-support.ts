import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
export interface SchemaProjection {
    additionalProperties?: boolean;
    required?: string[];
    properties?: Record<string, SchemaProjection>;
    const?: string;
    pattern?: string;
}
