import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { accessSync, chmodSync, constants as fsConstants, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createConnection, createServer, type Server } from 'node:net';
import { TRESEED_KEY_AGENT_IDLE_TIMEOUT_MS, KeyAgentCommand, KeyAgentError, KeyAgentResponse, KeyAgentSessionState, detectSocketKind, ensureParent, unwrapMachineKey } from './treseed-machine-key-passphrase-env.ts';
import { clearPidFile, createStatus, getKeyAgentPaths, inspectKeyAgentDiagnostics, maybeExpireSession, readWrappedMachineKeyFile, replaceWrappedMachineKey, requestKeyAgentOverSocket, writePidFile } from './read-wrapped-machine-key-file.ts';

export function readLegacyProjectMachineKey(legacyKeyPath: string) {
	if (!existsSync(legacyKeyPath)) {
		return null;
	}
	try {
		return Buffer.from(readFileSync(legacyKeyPath, 'utf8').trim(), 'base64');
	} catch {
		return null;
	}
}

export function unwrapOrProvisionMachineKey(command: Extract<KeyAgentCommand, { command: 'unlock' }>) {
	const wrapped = readWrappedMachineKeyFile(command.keyPath);
	if (wrapped.wrapped) {
		return unwrapMachineKey(wrapped.wrapped, command.passphrase);
	}
	if (wrapped.plaintextLegacy) {
		if (!command.allowMigration) {
			throw new KeyAgentError(
				'wrapped_key_migration_required',
				'The Treeseed machine key is still stored in the legacy plaintext format. Run a migration or unlock interactively to wrap it first.',
				{ keyPath: command.keyPath },
			);
		}
		replaceWrappedMachineKey(command.keyPath, wrapped.plaintextLegacy, command.passphrase);
		return wrapped.plaintextLegacy;
	}
	if (!command.createIfMissing) {
		throw new KeyAgentError(
			'wrapped_key_missing',
			'No wrapped Treeseed machine key exists yet. Create one by unlocking interactively or with a startup passphrase.',
			{ keyPath: command.keyPath },
		);
	}
	const machineKey = randomBytes(32);
	replaceWrappedMachineKey(command.keyPath, machineKey, command.passphrase);
	return machineKey;
}

export function ok(response: Omit<KeyAgentResponse, 'ok'> = {}): KeyAgentResponse {
	return { ok: true, ...response };
}

export function fail(error: unknown, command: KeyAgentCommand): KeyAgentResponse {
	const wrappedState = command.keyPath ? readWrappedMachineKeyFile(command.keyPath) : { wrapped: null, migrationRequired: false };
	if (error instanceof KeyAgentError) {
		return {
			ok: false,
			code: error.code,
			message: error.message,
			status: {
				running: true,
				unlocked: false,
				wrappedKeyPresent: wrappedState.wrapped !== null,
				migrationRequired: Boolean(wrappedState.migrationRequired),
				keyPath: command.keyPath,
				socketPath: command.socketPath,
				idleTimeoutMs: command.idleTimeoutMs,
				idleRemainingMs: 0,
			},
		};
	}
	return {
		ok: false,
		code: 'unlock_failed',
		message: error instanceof Error ? error.message : String(error),
		status: {
			running: true,
			unlocked: false,
			wrappedKeyPresent: wrappedState.wrapped !== null,
			migrationRequired: Boolean(wrappedState.migrationRequired),
			keyPath: command.keyPath,
			socketPath: command.socketPath,
			idleTimeoutMs: command.idleTimeoutMs,
			idleRemainingMs: 0,
		},
	};
}

export function handleKeyAgentCommand(
	command: KeyAgentCommand,
	session: KeyAgentSessionState,
) {
	maybeExpireSession(session);
	if (command.command === 'health') {
		return ok({
			status: createStatus(command, session),
		});
	}
	if (command.command === 'status') {
		return ok({ status: createStatus(command, session) });
	}
	if (command.command === 'lock') {
		session.machineKey = null;
		return ok({ status: createStatus(command, session) });
	}
	if (command.command === 'touch') {
		if (!session.machineKey) {
			return fail(new KeyAgentError('locked', 'Treeseed secret session is locked.'), command);
		}
		session.lastTouchedAt = Date.now();
		return ok({ status: createStatus(command, session) });
	}
	if (command.command === 'unlock') {
		try {
			session.machineKey = unwrapOrProvisionMachineKey(command);
			session.lastTouchedAt = Date.now();
			session.idleTimeoutMs = command.idleTimeoutMs;
			return ok({ status: createStatus(command, session) });
		} catch (error) {
			return fail(error, command);
		}
	}
	if (!session.machineKey) {
		return fail(new KeyAgentError('locked', 'Treeseed secret session is locked.'), command);
	}
	session.lastTouchedAt = Date.now();
	return ok({
		status: createStatus(command, session),
		machineKey: session.machineKey.toString('base64'),
	});
}

export async function requestKeyAgent(command: KeyAgentCommand): Promise<KeyAgentResponse> {
	const diagnostics = await inspectKeyAgentDiagnostics(command.socketPath);
	if (!diagnostics.healthOk && command.command !== 'health') {
		throw new KeyAgentError('daemon_unavailable', diagnostics.lastError ?? 'Treeseed key-agent is not running.', { diagnostics });
	}
	return requestKeyAgentOverSocket(command);
}

export async function socketAlreadyServed(socketPath: string) {
	const diagnostics = await inspectKeyAgentDiagnostics(socketPath);
	return diagnostics.socketConnectable && diagnostics.healthOk;
}

export async function removeStaleSocket(socketPath: string) {
	if (!existsSync(socketPath)) {
		return true;
	}
	const socketKind = detectSocketKind(socketPath);
	if (socketKind !== 'socket') {
		rmSync(socketPath, { force: true });
		clearPidFile(socketPath);
		return true;
	}
	const diagnostics = await inspectKeyAgentDiagnostics(socketPath);
	if (diagnostics.socketConnectable && diagnostics.healthOk) {
		return false;
	}
	rmSync(socketPath, { force: true });
	clearPidFile(socketPath);
	return true;
}

export async function startKeyAgentServer(options: {
	keyPath: string;
	socketPath?: string;
	idleTimeoutMs?: number;
}) {
	const socketPath = options.socketPath ?? getKeyAgentPaths().socketPath;
	const canStart = await removeStaleSocket(socketPath);
	if (!canStart) {
		return;
	}
	ensureParent(socketPath);

	const session: KeyAgentSessionState = {
		machineKey: null,
		lastTouchedAt: 0,
		idleTimeoutMs: options.idleTimeoutMs ?? TRESEED_KEY_AGENT_IDLE_TIMEOUT_MS,
	};

	const cleanup = () => {
		try {
			rmSync(socketPath, { force: true });
			clearPidFile(socketPath);
		} catch {
			// Ignore cleanup failures on exit.
		}
	};

	const server = createServer((connection) => {
		let requestBuffer = '';
		connection.setEncoding('utf8');
		connection.on('data', (chunk) => {
			requestBuffer += chunk;
			const newlineIndex = requestBuffer.indexOf('\n');
			if (newlineIndex === -1) {
				return;
			}
			const line = requestBuffer.slice(0, newlineIndex).trim();
			requestBuffer = '';
			let response: KeyAgentResponse;
			try {
				const parsed = JSON.parse(line) as KeyAgentCommand;
				response = handleKeyAgentCommand(parsed, session);
			} catch (error) {
				response = fail(error, {
					command: 'status',
					keyPath: options.keyPath,
					socketPath,
					idleTimeoutMs: options.idleTimeoutMs ?? TRESEED_KEY_AGENT_IDLE_TIMEOUT_MS,
				});
			}
			connection.end(`${JSON.stringify(response)}\n`);
		});
		connection.on('error', () => {
			connection.destroy();
		});
	});

	await new Promise<void>((resolvePromise, rejectPromise) => {
		server.once('error', (error) => {
			rejectPromise(error);
		});
		server.listen(socketPath, () => {
			chmodSync(socketPath, 0o600);
			writePidFile(socketPath);
			resolvePromise();
		});
	});

	process.on('exit', cleanup);
	process.on('SIGINT', () => {
		cleanup();
		process.exit(0);
	});
	process.on('SIGTERM', () => {
		cleanup();
		process.exit(0);
	});

	await new Promise<void>(() => {});
	server.close();
}

export function assertKeyAgentResponse(response: KeyAgentResponse, fallback = 'Treeseed secret session request failed.') {
	if (response.ok) {
		return response;
	}
	throw new KeyAgentError(
		(response.code as KeyAgentError['code']) ?? 'unlock_failed',
		response.message ?? fallback,
		{
			status: response.status,
			diagnostics: response.diagnostics,
		},
	);
}

export function rotateWrappedMachineKeyPassphrase(keyPath: string, machineKey: Buffer, passphrase: string) {
	return replaceWrappedMachineKey(keyPath, machineKey, passphrase);
}
