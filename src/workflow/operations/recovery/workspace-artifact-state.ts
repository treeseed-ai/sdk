import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type WorkspaceArtifactEntry = {
	revision: string;
	builtAt: string;
};

type WorkspaceArtifactState = {
	schema: 'treeseed.workspace-artifacts/v1';
	packages: Record<string, WorkspaceArtifactEntry>;
};

export type WorkspacePackageArtifactInspection = {
	current: boolean;
	reason: 'current' | 'missing-artifact' | 'missing-state' | 'revision-changed';
	missingArtifacts: string[];
	recordedRevision: string | null;
};

const EMPTY_STATE: WorkspaceArtifactState = {
	schema: 'treeseed.workspace-artifacts/v1',
	packages: {},
};

export function workspaceArtifactStatePath(root: string) {
	return resolve(root, '.treeseed', 'workflow', 'workspace-artifacts.json');
}

function readWorkspaceArtifactState(root: string): WorkspaceArtifactState {
	try {
		const parsed = JSON.parse(readFileSync(workspaceArtifactStatePath(root), 'utf8')) as Partial<WorkspaceArtifactState>;
		if (parsed.schema === EMPTY_STATE.schema && parsed.packages && typeof parsed.packages === 'object') {
			return { schema: EMPTY_STATE.schema, packages: parsed.packages };
		}
	} catch {
		// Missing or invalid generated state is repaired by rebuilding the package artifacts.
	}
	return { ...EMPTY_STATE, packages: {} };
}

export function inspectWorkspacePackageArtifacts(
	root: string,
	input: { packageName: string; revision: string; artifactPaths: string[] },
): WorkspacePackageArtifactInspection {
	const missingArtifacts = input.artifactPaths.filter((path) => !existsSync(path));
	const recordedRevision = readWorkspaceArtifactState(root).packages[input.packageName]?.revision ?? null;
	if (missingArtifacts.length > 0) {
		return { current: false, reason: 'missing-artifact', missingArtifacts, recordedRevision };
	}
	if (!recordedRevision) {
		return { current: false, reason: 'missing-state', missingArtifacts, recordedRevision };
	}
	if (recordedRevision !== input.revision) {
		return { current: false, reason: 'revision-changed', missingArtifacts, recordedRevision };
	}
	return { current: true, reason: 'current', missingArtifacts, recordedRevision };
}

export function recordWorkspacePackageArtifacts(root: string, packageName: string, revision: string) {
	const path = workspaceArtifactStatePath(root);
	const state = readWorkspaceArtifactState(root);
	const next: WorkspaceArtifactState = {
		...state,
		packages: {
			...state.packages,
			[packageName]: { revision, builtAt: new Date().toISOString() },
		},
	};
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.tmp`;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
		renameSync(temporaryPath, path);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
	return next.packages[packageName];
}
