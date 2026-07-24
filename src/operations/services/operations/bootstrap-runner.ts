import { spawn } from 'node:child_process';
import { elapsedMs, formatDurationMs, type TimingEntry } from '../../../entrypoints/runtime/timing.ts';

export type BootstrapExecution = 'parallel' | 'sequential';
export type BootstrapStream = 'stdout' | 'stderr';
export type BootstrapWriter = (line: string, stream?: BootstrapStream) => void;

export type BootstrapTaskPrefix = {
	scope: string;
	system: string;
	task: string;
	stage: string;
};

export type BootstrapDagNode<TResult = unknown> = {
	id: string;
	dependencies?: string[];
	run: () => Promise<TResult> | TResult;
	label?: string;
};

export function formatBootstrapPrefix(prefix: BootstrapTaskPrefix) {
	return `[${prefix.scope}][${prefix.system}][${prefix.task}][${prefix.stage}]`;
}

export function formatBootstrapLine(prefix: BootstrapTaskPrefix, line: string) {
	return `${formatBootstrapPrefix(prefix)} ${line}`;
}

export function writeBootstrapLine(
	write: BootstrapWriter | undefined,
	prefix: BootstrapTaskPrefix,
	line: string,
	stream: BootstrapStream = 'stdout',
) {
	const formatted = formatBootstrapLine(prefix, line);
	if (write) {
		write(formatted, stream);
		return;
	}
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${formatted}\n`);
}

function dependencyLevels<T extends BootstrapDagNode>(nodes: T[]) {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const remaining = new Map(byId);
	const completed = new Set<string>();
	const levels: T[][] = [];

	for (const node of nodes) {
		for (const dependency of node.dependencies ?? []) {
			if (!byId.has(dependency)) {
				throw new Error(`Bootstrap DAG node "${node.id}" depends on missing node "${dependency}".`);
			}
		}
	}

	while (remaining.size > 0) {
		const ready = [...remaining.values()].filter((node) =>
			(node.dependencies ?? []).every((dependency) => completed.has(dependency)),
		);
		if (ready.length === 0) {
			throw new Error('Bootstrap DAG contains a dependency cycle.');
		}
		for (const node of ready) {
			remaining.delete(node.id);
			completed.add(node.id);
		}
		levels.push(ready);
	}

	return levels;
}

export async function runBootstrapDag<TResult = unknown>({
	nodes,
	execution = 'parallel',
	write,
	timings,
}: {
	nodes: Array<BootstrapDagNode<TResult>>;
	execution?: BootstrapExecution;
	write?: BootstrapWriter;
	timings?: TimingEntry[];
}) {
	const results = new Map<string, TResult>();
	const recordNode = async (node: BootstrapDagNode<TResult>) => {
		const label = node.label ?? node.id;
		const startMs = performance.now();
		const entry: TimingEntry = {
			name: `bootstrap:${label}`,
			durationMs: 0,
			status: 'running',
			metadata: { nodeId: node.id, dependencies: node.dependencies ?? [] },
		};
		timings?.push(entry);
		write?.(`[bootstrap][${node.id}] started`);
		try {
			const result = await Promise.resolve(node.run());
			entry.durationMs = elapsedMs(startMs);
			entry.status = 'success';
			write?.(`[bootstrap][${node.id}] completed in ${formatDurationMs(entry.durationMs)}`);
			results.set(node.id, result);
		} catch (error) {
			entry.durationMs = elapsedMs(startMs);
			entry.status = 'failed';
			entry.metadata = {
				...(entry.metadata ?? {}),
				error: error instanceof Error ? error.message : String(error),
			};
			write?.(`[bootstrap][${node.id}] failed after ${formatDurationMs(entry.durationMs)}`, 'stderr');
			throw error;
		}
	};
	for (const level of dependencyLevels(nodes)) {
		if (execution === 'sequential') {
			for (const node of level) {
				await recordNode(node);
			}
			continue;
		}
		await Promise.all(level.map(recordNode));
	}
	return results;
}

export async function sleep(milliseconds: number) {
	if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
		return;
	}
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runPrefixedCommand(
	command: string,
	args: string[],
	{
		cwd,
		env = process.env,
		input,
		write,
		prefix,
		timeoutMs,
	}: {
		cwd: string;
		env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
		input?: string;
		write?: BootstrapWriter;
		prefix: BootstrapTaskPrefix;
		timeoutMs?: number;
	},
) {
	return await new Promise<{ status: number | null; stdout: string; stderr: string; timedOut?: boolean }>((resolvePromise, reject) => {
		const childEnv: Record<string, string> = {};
		for (const [key, value] of Object.entries({ ...process.env, ...env })) {
			if (value !== undefined) {
				childEnv[key] = String(value);
			}
		}
		const child = spawn(command, args, {
			cwd,
			env: childEnv,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		let stdoutBuffer = '';
		let stderrBuffer = '';
		let timedOut = false;
		let forceKillTimer: NodeJS.Timeout | null = null;
		const timeoutTimer = Number.isFinite(timeoutMs) && Number(timeoutMs) > 0
			? setTimeout(() => {
				timedOut = true;
				const message = `Command timed out after ${Math.round(Number(timeoutMs) / 1000)}s: ${command} ${args.join(' ')}`;
				stderr += `${stderr.endsWith('\n') || stderr.length === 0 ? '' : '\n'}${message}\n`;
				stderrBuffer += `${stderrBuffer.endsWith('\n') || stderrBuffer.length === 0 ? '' : '\n'}${message}\n`;
				flush('stderr');
				child.kill('SIGTERM');
				forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
			}, Number(timeoutMs))
			: null;
		const flush = (stream: BootstrapStream, force = false) => {
			let buffer = stream === 'stdout' ? stdoutBuffer : stderrBuffer;
			let newlineIndex = buffer.search(/\r?\n/u);
			while (newlineIndex >= 0) {
				const line = buffer.slice(0, newlineIndex).replace(/\r$/u, '');
				writeBootstrapLine(write, prefix, line, stream);
				buffer = buffer.slice(buffer[newlineIndex] === '\r' && buffer[newlineIndex + 1] === '\n' ? newlineIndex + 2 : newlineIndex + 1);
				newlineIndex = buffer.search(/\r?\n/u);
			}
			if (force && buffer.length > 0) {
				writeBootstrapLine(write, prefix, buffer.replace(/\r$/u, ''), stream);
				buffer = '';
			}
			if (stream === 'stdout') {
				stdoutBuffer = buffer;
			} else {
				stderrBuffer = buffer;
			}
		};

		child.stdout.on('data', (chunk) => {
			const text = String(chunk);
			stdout += text;
			stdoutBuffer += text;
			flush('stdout');
		});
		child.stderr.on('data', (chunk) => {
			const text = String(chunk);
			stderr += text;
			stderrBuffer += text;
			flush('stderr');
		});
		child.on('error', reject);
		child.on('close', (status) => {
			if (timeoutTimer) {
				clearTimeout(timeoutTimer);
			}
			if (forceKillTimer) {
				clearTimeout(forceKillTimer);
			}
			flush('stdout', true);
			flush('stderr', true);
			resolvePromise({ status, stdout, stderr, ...(timedOut ? { timedOut: true } : {}) });
		});
		if (input !== undefined) {
			child.stdin.end(input);
		} else {
			child.stdin.end();
		}
	});
}
