import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeProofInputHash, createProofRecord, type TreeseedProofInput } from '../../src/operations/services/release-proof.ts';
import { findReusableProof, invalidateProofs, readProofLedger, writeProofRecord } from '../../src/operations/services/release-proof-ledger.ts';

const roots: string[] = [];

function testRoot() {
	const tempRoot = resolve('.treeseed', 'test-tmp');
	mkdirSync(tempRoot, { recursive: true });
	const root = mkdtempSync(join(tempRoot, 'proof-ledger-'));
	roots.push(root);
	mkdirSync(root, { recursive: true });
	return root;
}

function proofInput(overrides: Partial<TreeseedProofInput> = {}): TreeseedProofInput {
	return {
		subject: {
			kind: 'package',
			id: 'package:@treeseed/sdk',
			name: '@treeseed/sdk',
			repoPath: '/repo/packages/sdk',
			repository: 'treeseed-ai/sdk',
			branch: 'staging',
			headSha: 'abc123',
		},
		driver: 'github-hosted',
		inputs: {
			topologyHash: 'topology',
			packageJsonHash: 'package-json',
			lockfileHash: 'lockfile',
			manifestHash: 'manifest',
			workflowHash: 'workflow',
			dockerfileHash: null,
			sourceHashes: { head: 'abc123' },
			dependencyProofIds: [],
		},
		...overrides,
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('release proof ledger', () => {
	it('computes stable input hashes independent of object key order', () => {
		const left = computeProofInputHash({ b: 2, a: { y: 1, x: 2 } });
		const right = computeProofInputHash({ a: { x: 2, y: 1 }, b: 2 });
		expect(left).toBe(right);
	});

	it('reuses only passed proof records with the same driver and input hash', () => {
		const root = testRoot();
		const input = proofInput();
		const record = createProofRecord({
			...input,
			status: 'passed',
			startedAt: '2026-01-01T00:00:00.000Z',
			finishedAt: '2026-01-01T00:00:01.000Z',
		});
		writeProofRecord(root, record);

		expect(findReusableProof(root, input)?.proofId).toBe(record.proofId);
		expect(findReusableProof(root, { ...input, driver: 'act' })).toBeNull();
		expect(findReusableProof(root, {
			...input,
			inputs: { ...input.inputs, workflowHash: 'changed' },
		})).toBeNull();
	});

	it('does not reuse failed proof records and supports invalidation', () => {
		const root = testRoot();
		const input = proofInput();
		const record = createProofRecord({
			...input,
			status: 'failed',
			startedAt: '2026-01-01T00:00:00.000Z',
			finishedAt: '2026-01-01T00:00:01.000Z',
		});
		writeProofRecord(root, record);

		expect(findReusableProof(root, input)).toBeNull();
		expect(readProofLedger(root)).toHaveLength(1);
		invalidateProofs(root, (entry) => entry.subject.id === input.subject.id);
		expect(readProofLedger(root)).toHaveLength(0);
	});
});
