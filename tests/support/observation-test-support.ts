import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
export interface Schema { safeParse(value: unknown): { success: boolean }; }
export interface FixtureIdentity { installationId: string; serviceId: string; compositionGeneration: string; serviceGeneration: string; assetDigest: string; origin: string; runtime: { packageSetDigest: string; entryDigest: string; imageManifestDigest: string } | null; }
export class ObservationTests {
    fixture(): { formatVersion: number; identity: FixtureIdentity; dependencies: Array<{ port: string; bindingId: string; contractId: string; contractVersion: string; identity: FixtureIdentity; endpoints: Record<string, string> }> } {
        const identity = { installationId: 'fixture', serviceId: 'gateway', compositionGeneration: 'a'.repeat(64), serviceGeneration: 'b'.repeat(64), assetDigest: 'c'.repeat(64), origin: 'https://localhost:58443', runtime: null };
        return { formatVersion: 1, identity, dependencies: [{ port: 'backend', bindingId: 'backend.http', contractId: 'service.http', contractVersion: '1.0.0', identity: { ...identity, serviceId: 'worker-two', serviceGeneration: 'd'.repeat(64), runtime: { packageSetDigest: 'e'.repeat(64), entryDigest: 'f'.repeat(64), imageManifestDigest: '0'.repeat(64) } }, endpoints: { http: 'http://172.19.0.2:8080' } }] };
    }
}
