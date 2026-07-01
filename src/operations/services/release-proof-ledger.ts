import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
	computeProofInputHash,
	proofIdFor,
	type TreeseedProofDriver,
	type TreeseedProofInput,
	type TreeseedProofRecord,
} from './release-proof.ts';

const PROOF_DIR = '.treeseed/workflow/proofs';

function proofRoot(root: string) {
	return resolve(root, PROOF_DIR);
}

function proofPath(root: string, proofId: string) {
	return resolve(proofRoot(root), `${proofId}.json`);
}

function isProofRecord(value: unknown): value is TreeseedProofRecord {
	return Boolean(value && typeof value === 'object'
		&& (value as TreeseedProofRecord).schemaVersion === 1
		&& typeof (value as TreeseedProofRecord).proofId === 'string'
		&& typeof (value as TreeseedProofRecord).status === 'string');
}

export function readProofLedger(root: string): TreeseedProofRecord[] {
	const dir = proofRoot(root);
	if (!existsSync(dir)) return [];
	const records: TreeseedProofRecord[] = [];
	for (const entry of readdirSync(dir)) {
		if (!entry.endsWith('.json')) continue;
		try {
			const parsed = JSON.parse(readFileSync(resolve(dir, entry), 'utf8')) as unknown;
			if (isProofRecord(parsed)) records.push(parsed);
		} catch {
			// Ignore corrupt proof records; future writes will replace matching records.
		}
	}
	return records.sort((left, right) => String(right.finishedAt ?? '').localeCompare(String(left.finishedAt ?? '')));
}

export function writeProofRecord(root: string, record: TreeseedProofRecord): void {
	const filePath = proofPath(root, record.proofId);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

export function findReusableProof(
	root: string,
	input: TreeseedProofInput & { requiredDriver?: TreeseedProofDriver },
): TreeseedProofRecord | null {
	const inputHash = input.inputs.inputHash || computeProofInputHash({
		subject: input.subject,
		driver: input.driver,
		inputs: {
			...input.inputs,
			dependencyProofIds: [...input.inputs.dependencyProofIds].sort(),
			inputHash: undefined,
		},
	});
	const proofId = proofIdFor({
		subject: input.subject,
		driver: input.driver,
		inputs: {
			...input.inputs,
			inputHash,
			dependencyProofIds: [...input.inputs.dependencyProofIds].sort(),
		},
	});
	return readProofLedger(root).find((record) =>
		record.proofId === proofId
		&& record.status === 'passed'
		&& record.reusable === true
		&& record.inputs.inputHash === inputHash
		&& record.driver === (input.requiredDriver ?? input.driver)) ?? null;
}

export function invalidateProofs(root: string, predicate: (record: TreeseedProofRecord) => boolean): void {
	for (const record of readProofLedger(root)) {
		if (!predicate(record)) continue;
		rmSync(proofPath(root, record.proofId), { force: true });
	}
}

export function cleanProofLedger(root: string, options: { olderThanMs: number; now?: number }) {
	const now = options.now ?? Date.now();
	let removed = 0;
	for (const record of readProofLedger(root)) {
		const finished = Date.parse(record.finishedAt ?? record.startedAt);
		if (!Number.isFinite(finished) || now - finished < options.olderThanMs) continue;
		rmSync(proofPath(root, record.proofId), { force: true });
		removed += 1;
	}
	return { removed };
}
