import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export class RegistryPropagationError extends Error {}

export type PublishedPackageReadbackInput = {
	packageName: string;
	packageVersion: string;
	packageDigest: string;
	latestDistTag: string;
	destination: string;
	cwd: string;
	deadlineMs?: number;
	perCallTimeoutMs?: number;
	execNpm?: (args: string[], timeout: number) => string;
	readArtifact?: (path: string) => Buffer;
	now?: () => number;
	delay?: (milliseconds: number) => Promise<void>;
};

const retryableRegistryFailure = (error: unknown): boolean => {
	if (error instanceof RegistryPropagationError) return true;
	const output = `${String((error as { stdout?: unknown }).stdout ?? '')}\n${String((error as { stderr?: unknown }).stderr ?? '')}\n${error instanceof Error ? error.message : String(error)}`;
	return ['E404', 'ETARGET', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'E502', 'E503', 'E504', 'FETCH_ERROR']
		.some((marker) => output.includes(marker));
};

export async function readBackPublishedPackage(input: PublishedPackageReadbackInput): Promise<{
	packageVersion: string;
	packageDigest: string;
	rc: string;
	latest: string;
}> {
	const now = input.now ?? Date.now;
	const delay = input.delay ?? ((milliseconds: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
	const deadline = now() + (input.deadlineMs ?? 120_000);
	const perCallTimeout = input.perCallTimeoutMs ?? 15_000;
	const execNpm = input.execNpm ?? ((args, timeout) => execFileSync('npm', args, {
		cwd: input.cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout,
	}));
	const readArtifact = input.readArtifact ?? readFileSync;
	const remainingTimeout = (): number => Math.max(1, Math.min(perCallTimeout, deadline - now()));
	const waitForPropagation = async (error: unknown): Promise<void> => {
		if (!retryableRegistryFailure(error) || now() >= deadline) throw error;
		await delay(Math.min(3000, Math.max(1, deadline - now())));
	};

	let observedDigest = '';
	let tags: Record<string, string> = {};
	while (!observedDigest) {
		try {
			const packed = JSON.parse(execNpm([
				'pack', `${input.packageName}@${input.packageVersion}`, '--json', '--ignore-scripts', '--prefer-online',
				'--pack-destination', input.destination,
			], remainingTimeout())) as Array<{ filename: string }>;
			observedDigest = `sha256:${createHash('sha256').update(readArtifact(resolve(input.destination, packed[0]!.filename))).digest('hex')}`;
		} catch (error) {
			await waitForPropagation(error);
		}
	}
	if (observedDigest !== input.packageDigest) throw new Error(`Published SDK digest ${observedDigest} does not match ${input.packageDigest}.`);

	while (tags.rc !== input.packageVersion) {
		try {
			tags = JSON.parse(execNpm(['view', input.packageName, 'dist-tags', '--json', '--prefer-online'], remainingTimeout())) as Record<string, string>;
			if (tags.latest !== input.latestDistTag) throw new Error(`npm latest changed from ${input.latestDistTag} to ${tags.latest ?? 'nothing'}.`);
			if (tags.rc !== input.packageVersion) throw new RegistryPropagationError(`npm rc points to ${tags.rc ?? 'nothing'}, expected ${input.packageVersion}.`);
		} catch (error) {
			await waitForPropagation(error);
		}
	}

	return { packageVersion: input.packageVersion, packageDigest: observedDigest, rc: tags.rc, latest: tags.latest! };
}
