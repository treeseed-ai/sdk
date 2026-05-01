import { approveAll, CopilotClient } from '@github/copilot-sdk';
import {
	createTreeseedManagedToolEnv,
	resolveTreeseedToolBinary,
} from './managed-dependencies.ts';

export type TreeseedCopilotTaskInput = {
	prompt: string;
	cwd?: string;
	model?: string;
	allowTools?: string[];
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
};

export type TreeseedCopilotTaskResult = {
	status: 'completed' | 'failed';
	summary: string;
	stdout: string;
	stderr: string;
};

export async function runTreeseedCopilotTask(input: TreeseedCopilotTaskInput): Promise<TreeseedCopilotTaskResult> {
	const cwd = input.cwd ?? process.cwd();
	const env = createTreeseedManagedToolEnv(input.env ?? process.env);
	const cliPath = resolveTreeseedToolBinary('copilot', { env });
	if (!cliPath) {
		return {
			status: 'failed',
			summary: 'Copilot task failed.',
			stdout: '',
			stderr: 'Copilot CLI is unavailable.',
		};
	}

	const client = new CopilotClient({
		cliPath,
		cwd,
		env,
		logLevel: 'error',
		useStdio: true,
	});
	let session: Awaited<ReturnType<CopilotClient['createSession']>> | null = null;
	const messages: string[] = [];
	const errors: string[] = [];

	try {
		session = await client.createSession({
			clientName: 'treeseed',
			model: input.model,
			availableTools: input.allowTools && input.allowTools.length > 0 ? input.allowTools : undefined,
			onPermissionRequest: approveAll,
			workingDirectory: cwd,
			onEvent(event) {
				if (event.type === 'assistant.message' && event.data.content.trim()) {
					messages.push(event.data.content);
				}
				if (event.type === 'session.error') {
					errors.push(event.data.message);
				}
			},
		});
		const finalMessage = await session.sendAndWait({ prompt: input.prompt }, input.timeoutMs ?? 10 * 60 * 1000);
		const stdout = finalMessage?.data.content ?? messages.at(-1) ?? messages.join('\n\n');
		return {
			status: errors.length > 0 ? 'failed' : 'completed',
			summary: errors.length > 0 ? 'Copilot task failed.' : 'Copilot task completed.',
			stdout,
			stderr: errors.join('\n'),
		};
	} catch (error) {
		return {
			status: 'failed',
			summary: 'Copilot task failed.',
			stdout: messages.join('\n\n'),
			stderr: [
				...errors,
				error instanceof Error ? error.message : String(error),
			].filter(Boolean).join('\n'),
		};
	} finally {
		try {
			await session?.disconnect();
		} catch {
			// Best-effort cleanup; the client stop below tears down the spawned CLI process.
		}
		const stopErrors = await client.stop();
		if (stopErrors.length > 0 && errors.length === 0) {
			await client.forceStop();
		}
	}
}
