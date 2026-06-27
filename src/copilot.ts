import { approveAll, CopilotClient, type Tool } from '@github/copilot-sdk';
import {
	createTreeseedManagedToolEnv,
	resolveTreeseedToolBinary,
} from './managed-dependencies.ts';
import {
	resolveTreeseedGitHubCopilotToken,
	resolveTreeseedGitHubToken,
} from './service-credentials.ts';

export type TreeseedCopilotTool = Tool;

export type TreeseedCopilotTaskInput = {
	prompt: string;
	cwd?: string;
	model?: string;
	allowTools?: string[];
	tools?: TreeseedCopilotTool[];
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
};

export type TreeseedCopilotTaskResult = {
	status: 'completed' | 'failed';
	summary: string;
	stdout: string;
	stderr: string;
};

function configuredValue(env: NodeJS.ProcessEnv, key: string) {
	const value = env[key];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function resolveCopilotAuthToken(env: NodeJS.ProcessEnv) {
	return resolveTreeseedGitHubCopilotToken(env)
		|| resolveTreeseedGitHubToken(env)
		|| configuredValue(env, 'COPILOT_GITHUB_TOKEN')
		|| configuredValue(env, 'GH_TOKEN')
		|| configuredValue(env, 'GITHUB_TOKEN');
}

export async function runTreeseedCopilotTask(input: TreeseedCopilotTaskInput): Promise<TreeseedCopilotTaskResult> {
	const cwd = input.cwd ?? process.cwd();
	const baseEnv = createTreeseedManagedToolEnv(input.env ?? process.env);
	const copilotAuthToken = resolveCopilotAuthToken(baseEnv);
	const env = copilotAuthToken
		? { ...baseEnv, COPILOT_GITHUB_TOKEN: copilotAuthToken }
		: baseEnv;
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
		gitHubToken: copilotAuthToken || undefined,
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
			tools: input.tools,
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
