import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { findTreeseedPackageAdapter } from '../../operations/services/package-adapters.ts';
import type { TreeseedReconcileRunContext, TreeseedReconcileSelector, TreeseedReconcileTarget } from '../contracts.ts';

export function runReleaseVerifyCommand(input: {
	tenantRoot: string;
	packageId: string;
	env?: NodeJS.ProcessEnv;
}) {
	const adapter = findTreeseedPackageAdapter(input.tenantRoot, input.packageId);
	if (!adapter) {
		throw new Error(`Package ${input.packageId} was not discovered.`);
	}
	const command = adapter.verifyCommands.release ?? adapter.verifyCommands.local;
	if (!command) {
		return {
			ok: true,
			skipped: true,
			reason: `${input.packageId} has no release verify command.`,
		};
	}
	const result = spawnSync(command.command, command.args, {
		cwd: command.cwd,
		env: { ...process.env, ...(input.env ?? {}) },
		encoding: 'utf8',
	});
	return {
		ok: (result.status ?? 1) === 0,
		status: result.status,
		command,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}

export function writeReleaseRecord(input: {
	tenantRoot: string;
	recordPath: string;
	record: Record<string, unknown>;
}) {
	const absolutePath = resolve(input.tenantRoot, input.recordPath);
	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, `${JSON.stringify(input.record, null, 2)}\n`, 'utf8');
	return {
		path: absolutePath,
		record: input.record,
	};
}

export async function runHostedReconcileGate(input: {
	parentContext: TreeseedReconcileRunContext;
	selector: TreeseedReconcileSelector;
	target: TreeseedReconcileTarget;
	dryRun: boolean;
}) {
	const { reconcileTreeseedNestedTarget } = await import('../engine.ts');
	return reconcileTreeseedNestedTarget(input);
}

export async function runHostedVerifyGate(input: {
	parentContext: TreeseedReconcileRunContext;
	selector: TreeseedReconcileSelector;
	target: TreeseedReconcileTarget;
}) {
	const { verifyTreeseedNestedTarget } = await import('../engine.ts');
	return verifyTreeseedNestedTarget(input);
}
