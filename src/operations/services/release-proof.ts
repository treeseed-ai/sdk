import { createHash } from 'node:crypto';

export type TreeseedProofSubjectKind =
	| 'package'
	| 'root'
	| 'hosted-app'
	| 'provider-resource'
	| 'workflow'
	| 'scene';

export type TreeseedProofStatus =
	| 'passed'
	| 'failed'
	| 'pending'
	| 'blocked'
	| 'skipped';

export type TreeseedProofDriver =
	| 'local'
	| 'act'
	| 'github-hosted'
	| 'railway-live'
	| 'cloudflare-live'
	| 'reconcile-live';

export type TreeseedProofSubject = {
	kind: TreeseedProofSubjectKind;
	id: string;
	name: string;
	repoPath: string;
	repository: string | null;
	branch: string | null;
	headSha: string | null;
};

export type TreeseedProofInputs = {
	inputHash: string;
	topologyHash: string;
	packageJsonHash?: string | null;
	lockfileHash?: string | null;
	manifestHash?: string | null;
	workflowHash?: string | null;
	dockerfileHash?: string | null;
	sourceHashes?: Record<string, string | null>;
	dependencyProofIds: string[];
};

export type TreeseedProofRecord = {
	schemaVersion: 1;
	proofId: string;
	subject: TreeseedProofSubject;
	inputs: TreeseedProofInputs;
	driver: TreeseedProofDriver;
	status: TreeseedProofStatus;
	startedAt: string;
	finishedAt: string | null;
	durationMs: number | null;
	result: {
		workflow?: {
			repository: string;
			workflow: string;
			runId: number | null;
			url: string | null;
			conclusion: string | null;
			failedJobs: Array<{
				id: number;
				name: string;
				url: string | null;
				failedSteps: string[];
				logExcerpt?: string | null;
			}>;
		};
		command?: {
			command: string;
			cwd: string;
			exitCode: number | null;
		};
		liveVerification?: Record<string, unknown>;
	};
	reusable: boolean;
	invalidationReasons: string[];
};

export type TreeseedProofInput = {
	subject: TreeseedProofSubject;
	inputs: Omit<TreeseedProofInputs, 'inputHash'> & { inputHash?: string };
	driver: TreeseedProofDriver;
};

function stableJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

export function sha256(value: string) {
	return createHash('sha256').update(value).digest('hex');
}

export function computeProofInputHash(input: TreeseedProofInput | Record<string, unknown>): string {
	return sha256(stableJson(input));
}

export function proofIdFor(input: TreeseedProofInput) {
	return sha256(stableJson({
		subject: input.subject,
		inputs: {
			...input.inputs,
			dependencyProofIds: [...input.inputs.dependencyProofIds].sort(),
		},
		driver: input.driver,
	}));
}

export function createProofRecord(input: {
	subject: TreeseedProofSubject;
	inputs: Omit<TreeseedProofInputs, 'inputHash'> & { inputHash?: string };
	driver: TreeseedProofDriver;
	status: TreeseedProofStatus;
	startedAt: string;
	finishedAt?: string | null;
	result?: TreeseedProofRecord['result'];
	reusable?: boolean;
	invalidationReasons?: string[];
}): TreeseedProofRecord {
	const normalizedInput: TreeseedProofInput = {
		subject: input.subject,
		driver: input.driver,
		inputs: {
			...input.inputs,
			dependencyProofIds: [...input.inputs.dependencyProofIds].sort(),
			inputHash: input.inputs.inputHash ?? '',
		},
	};
	const inputHash = input.inputs.inputHash || computeProofInputHash({
		subject: input.subject,
		driver: input.driver,
		inputs: {
			...input.inputs,
			dependencyProofIds: [...input.inputs.dependencyProofIds].sort(),
			inputHash: undefined,
		},
	});
	const finishedAt = input.finishedAt ?? new Date().toISOString();
	const startedMs = Date.parse(input.startedAt);
	const finishedMs = finishedAt ? Date.parse(finishedAt) : NaN;
	return {
		schemaVersion: 1,
		proofId: proofIdFor({
			...normalizedInput,
			inputs: {
				...normalizedInput.inputs,
				inputHash,
			},
		}),
		subject: input.subject,
		inputs: {
			...input.inputs,
			inputHash,
			dependencyProofIds: [...input.inputs.dependencyProofIds].sort(),
		},
		driver: input.driver,
		status: input.status,
		startedAt: input.startedAt,
		finishedAt,
		durationMs: Number.isFinite(startedMs) && Number.isFinite(finishedMs) ? Math.max(0, finishedMs - startedMs) : null,
		result: input.result ?? {},
		reusable: input.reusable ?? input.status === 'passed',
		invalidationReasons: input.invalidationReasons ?? [],
	};
}
