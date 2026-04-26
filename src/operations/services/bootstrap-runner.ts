import { spawn } from 'node:child_process';

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
}: {
	nodes: Array<TreeseedBootstrapDagNode<TResult>>;
	execution?: TreeseedBootstrapExecution;
}) {
	const results = new Map<string, TResult>();
	for (const level of dependencyLevels(nodes)) {
		if (execution === 'sequential') {
			for (const node of level) {
				results.set(node.id, await Promise.resolve(node.run()));
			}
			continue;
		}
		await Promise.all(level.map(async (node) => {
			results.set(node.id, await Promise.resolve(node.run()));
		}));
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
		const child = spawn(command, args, {
			cwd,
			env: { ...process.env, ...env },
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
