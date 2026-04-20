#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import {
	assertTreeseedKeyAgentResponse,
	getTreeseedKeyAgentPaths,
	readWrappedMachineKeyFile,
	requestTreeseedKeyAgent,
	startTreeseedKeyAgentServer,
	TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS,
	TreeseedKeyAgentError,
	TRESEED_MACHINE_KEY_PASSPHRASE_ENV,
	type TreeseedKeyAgentCommand,
} from '../src/operations/services/key-agent.ts';

function parseArgs(argv: string[]) {
	const [mode = 'request', ...rest] = argv;
	const parsed = {
		mode,
		payload: '',
		keyPath: '',
		socketPath: '',
		idleTimeoutMs: TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS,
		allowMigration: false,
		createIfMissing: false,
	};

	while (rest.length > 0) {
		const current = rest.shift();
		if (!current) {
			continue;
		}
		if (!parsed.payload && !current.startsWith('--')) {
			parsed.payload = current;
			continue;
		}
		if (current === '--key-path') {
			parsed.keyPath = rest.shift() ?? '';
			continue;
		}
		if (current === '--socket-path') {
			parsed.socketPath = rest.shift() ?? '';
			continue;
		}
		if (current === '--idle-timeout-ms') {
			parsed.idleTimeoutMs = Number.parseInt(rest.shift() ?? String(TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS), 10);
			continue;
		}
		if (current === '--allow-migration') {
			parsed.allowMigration = true;
			continue;
		}
		if (current === '--create-if-missing') {
			parsed.createIfMissing = true;
			continue;
		}
	}

	return parsed;
}

function writeJson(payload: unknown) {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function prompt(question: string, secret = false) {
	return new Promise<string>((resolvePromise) => {
		if (!secret) {
			const rl = createInterface({ input, output });
			rl.question(question, (answer) => {
				rl.close();
				resolvePromise(answer);
			});
			return;
		}

		const rl = createInterface({ input, output, terminal: true });
		const previousWrite = (rl as unknown as { _writeToOutput?: (text: string) => void })._writeToOutput;
		(rl as unknown as { _writeToOutput?: (text: string) => void })._writeToOutput = function _writeToOutput(text: string) {
			if (text.trim()) {
				output.write('*');
			}
		};
		rl.question(question, (answer) => {
			output.write('\n');
			rl.close();
			(rl as unknown as { _writeToOutput?: (text: string) => void })._writeToOutput = previousWrite;
			resolvePromise(answer);
		});
	});
}

async function runInteractiveUnlock(parsed: ReturnType<typeof parseArgs>) {
	const wrapped = readWrappedMachineKeyFile(parsed.keyPath);
	if (wrapped.exists && !wrapped.wrapped && !wrapped.migrationRequired) {
		throw new TreeseedKeyAgentError('corrupt_wrapped_key', 'Unable to read the existing Treeseed machine key file.');
	}

	const needsCreation = !wrapped.exists;
	const needsMigration = wrapped.migrationRequired;
	let passphrase = '';

	if (needsCreation || needsMigration) {
		const action = needsCreation ? 'Create a new Treeseed passphrase: ' : 'Create a new Treeseed passphrase to wrap the existing machine key: ';
		const first = (await prompt(action, true)).trim();
		if (!first) {
			throw new TreeseedKeyAgentError('interactive_required', 'A non-empty passphrase is required.');
		}
		const second = (await prompt('Confirm passphrase: ', true)).trim();
		if (first !== second) {
			throw new TreeseedKeyAgentError('unlock_failed', 'The passphrase confirmation did not match.');
		}
		passphrase = first;
	} else {
		passphrase = (await prompt('Treeseed passphrase: ', true)).trim();
		if (!passphrase) {
			throw new TreeseedKeyAgentError('interactive_required', 'A passphrase is required to unlock the Treeseed machine key.');
		}
	}

	const response = await requestTreeseedKeyAgent({
		command: 'unlock',
		keyPath: parsed.keyPath,
		socketPath: parsed.socketPath,
		idleTimeoutMs: parsed.idleTimeoutMs,
		passphrase,
		createIfMissing: needsCreation || parsed.createIfMissing,
		allowMigration: needsMigration || parsed.allowMigration,
	});
	assertTreeseedKeyAgentResponse(response);
	writeJson(response);
}

async function main() {
	const parsed = parseArgs(process.argv.slice(2));
	const defaults = getTreeseedKeyAgentPaths();
	parsed.socketPath ||= defaults.socketPath;

	if (parsed.mode === 'serve') {
		if (!parsed.keyPath) {
			throw new Error('Missing --key-path for key-agent serve mode.');
		}
		await startTreeseedKeyAgentServer({
			keyPath: parsed.keyPath,
			socketPath: parsed.socketPath,
			idleTimeoutMs: parsed.idleTimeoutMs,
		});
		await new Promise(() => {});
		return;
	}

	if (parsed.mode === 'unlock-interactive') {
		await runInteractiveUnlock(parsed);
		return;
	}

	if (parsed.mode === 'unlock-from-env') {
		const passphrase = String(process.env[TRESEED_MACHINE_KEY_PASSPHRASE_ENV] ?? '').trim();
		if (!passphrase) {
			throw new TreeseedKeyAgentError(
				'interactive_required',
				`Set ${TRESEED_MACHINE_KEY_PASSPHRASE_ENV} before using unlock-from-env.`,
			);
		}
		const response = await requestTreeseedKeyAgent({
			command: 'unlock',
			keyPath: parsed.keyPath,
			socketPath: parsed.socketPath,
			idleTimeoutMs: parsed.idleTimeoutMs,
			passphrase,
			createIfMissing: parsed.createIfMissing,
			allowMigration: parsed.allowMigration,
		});
		assertTreeseedKeyAgentResponse(response);
		writeJson(response);
		return;
	}

	const payload = JSON.parse(parsed.payload) as TreeseedKeyAgentCommand;
	const response = await requestTreeseedKeyAgent(payload);
	writeJson(response);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	const code = error instanceof TreeseedKeyAgentError ? error.code : 'unlock_failed';
	writeJson({
		ok: false,
		code,
		message,
	});
	process.exit(1);
});
