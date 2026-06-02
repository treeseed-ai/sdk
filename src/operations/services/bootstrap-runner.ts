import { spawn } from 'node:child_process';
import { elapsedMs, formatDurationMs, type TreeseedTimingEntry } from '../../timing.ts';

export type TreeseedBootstrapExecution = 'parallel' | 'sequential';
export type TreeseedBootstrapStream = 'stdout' | 'stderr';
export type TreeseedBootstrapWriter = (line: string, stream?: TreeseedBootstrapStream) => void;

export type TreeseedBootstrapTaskPrefix = {
	scope: string;
	system: string;
	task: string;
	stage: string;
};

export type TreeseedBootstrapDagNode<TResult = unknown> = {
	id: string;
	dependencies?: string[];
	run: () => Promise<TResult> | TResult;
	label?: string;
};

export function formatTreeseedBootstrapPrefix(prefix: TreeseedBootstrapTaskPrefix) {
	return `[${prefix.scope}][${prefix.system}][${prefix.task}][${prefix.stage}]`;
}

export function formatTreeseedBootstrapLine(prefix: TreeseedBootstrapTaskPrefix, line: string) {
	return `${formatTreeseedBootstrapPrefix(prefix)} ${line}`;
}

export function writeTreeseedBootstrapLine(
	write: TreeseedBootstrapWriter | undefined,
	prefix: TreeseedBootstrapTaskPrefix,
	line: string,
	stream: TreeseedBootstrapStream = 'stdout',
) {
	const formatted = formatTreeseedBootstrapLine(prefix, line);
	if (write) {
		write(formatted, stream);
		return;
	}
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${formatted}\n`);
}

function dependencyLevels<T extends TreeseedBootstrapDagNode>(nodes: T[]) {
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

export async function runTreeseedBootstrapDag<TResult = unknown>({
	nodes,
	execution = 'parallel',
	write,
	timings,
}: {
	nodes: Array<TreeseedBootstrapDagNode<TResult>>;
	execution?: TreeseedBootstrapExecution;
	write?: TreeseedBootstrapWriter;
	timings?: TreeseedTimingEntry[];
}) {
	const results = new Map<string, TResult>();
	const recordNode = async (node: TreeseedBootstrapDagNode<TResult>) => {
		const label = node.label ?? node.id;
		const startMs = performance.now();
		const entry: TreeseedTimingEntry = {
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
	}: {
		cwd: string;
		env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
		input?: string;
		write?: TreeseedBootstrapWriter;
		prefix: TreeseedBootstrapTaskPrefix;
	},
) {
	return await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
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
		const flush = (stream: TreeseedBootstrapStream, force = false) => {
			let buffer = stream === 'stdout' ? stdoutBuffer : stderrBuffer;
			let newlineIndex = buffer.search(/\r?\n/u);
			while (newlineIndex >= 0) {
				const line = buffer.slice(0, newlineIndex).replace(/\r$/u, '');
				writeTreeseedBootstrapLine(write, prefix, line, stream);
				buffer = buffer.slice(buffer[newlineIndex] === '\r' && buffer[newlineIndex + 1] === '\n' ? newlineIndex + 2 : newlineIndex + 1);
				newlineIndex = buffer.search(/\r?\n/u);
			}
			if (force && buffer.length > 0) {
				writeTreeseedBootstrapLine(write, prefix, buffer.replace(/\r$/u, ''), stream);
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
			flush('stdout', true);
			flush('stderr', true);
			resolvePromise({ status, stdout, stderr });
		});
		if (input !== undefined) {
			child.stdin.end(input);
		} else {
			child.stdin.end();
		}
	});
}
