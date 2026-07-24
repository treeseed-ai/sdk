import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { accessSync, chmodSync, constants as fsConstants, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createConnection, createServer, type Server } from 'node:net';
import { KEY_AGENT_REQUEST_TIMEOUT_MS, KEY_AGENT_SOCKET_RELATIVE_PATH, KEY_AGENT_IDLE_TIMEOUT_MS, KeyAgentCommand, KeyAgentDiagnostics, KeyAgentError, KeyAgentResponse, KeyAgentSessionState, KeyAgentStatus, WrappedMachineKey, detectSocketKind, ensureParent, isWrappedMachineKeyPayload, pidFilePath, wrapMachineKey } from './treseed-machine-key-passphrase-env.ts';
import { ok } from './read-legacy-project-machine-key.ts';

export function readWrappedMachineKeyFile(keyPath: string) {
	if (!existsSync(keyPath)) {
		return {
			exists: false,
			wrapped: null,
			plaintextLegacy: null,
			migrationRequired: false,
		};
	}

	const raw = readFileSync(keyPath, 'utf8').trim();
	if (!raw) {
		return {
			exists: false,
			wrapped: null,
			plaintextLegacy: null,
			migrationRequired: false,
		};
	}

	try {
		const parsed = JSON.parse(raw);
		if (isWrappedMachineKeyPayload(parsed)) {
			return {
				exists: true,
				wrapped: parsed,
				plaintextLegacy: null,
				migrationRequired: false,
			};
		}
	} catch {
		// Fall through and treat it as the legacy base64 payload.
	}

	try {
		return {
			exists: true,
			wrapped: null,
			plaintextLegacy: Buffer.from(raw, 'base64'),
			migrationRequired: true,
		};
	} catch {
		throw new KeyAgentError(
			'corrupt_wrapped_key',
			'Unable to parse the Treeseed machine key file.',
			{ keyPath },
		);
	}
}

export function writeWrappedMachineKeyFile(keyPath: string, payload: WrappedMachineKey) {
	ensureParent(keyPath);
	writeFileSync(keyPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

export function replaceWrappedMachineKey(keyPath: string, machineKey: Buffer, passphrase: string) {
	const payload = wrapMachineKey(machineKey, passphrase);
	writeWrappedMachineKeyFile(keyPath, payload);
	return payload;
}

export function resolveRuntimeRoot() {
	const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
	if (typeof xdgRuntimeDir === 'string' && xdgRuntimeDir.trim().length > 0) {
		try {
			accessSync(xdgRuntimeDir, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
			return resolve(xdgRuntimeDir, 'treeseed');
		} catch {
			// Fall back to the home-managed runtime directory when XDG_RUNTIME_DIR is unavailable.
		}
	}
	const homeRoot = process.env.HOME && process.env.HOME.trim().length > 0 ? process.env.HOME : homedir();
	return resolve(homeRoot, dirname(KEY_AGENT_SOCKET_RELATIVE_PATH));
}

export function getKeyAgentPaths() {
	const homeRoot = process.env.HOME && process.env.HOME.trim().length > 0 ? process.env.HOME : homedir();
	const runtimeRoot = resolveRuntimeRoot();
	const socketPath = runtimeRoot === resolve(homeRoot, dirname(KEY_AGENT_SOCKET_RELATIVE_PATH))
		? resolve(homeRoot, KEY_AGENT_SOCKET_RELATIVE_PATH)
		: resolve(runtimeRoot, 'key-agent.sock');
	return {
		homeRoot,
		runtimeRoot,
		socketPath,
		pidPath: pidFilePath(socketPath),
	};
}

export function readAgentPid(socketPath: string) {
	const pidPath = pidFilePath(socketPath);
	if (!existsSync(pidPath)) {
		return null;
	}
	const raw = readFileSync(pidPath, 'utf8').trim();
	const pid = Number.parseInt(raw, 10);
	return Number.isFinite(pid) ? pid : null;
}

export function writePidFile(socketPath: string) {
	ensureParent(socketPath);
	writeFileSync(pidFilePath(socketPath), `${process.pid}\n`, { mode: 0o600 });
}

export function clearPidFile(socketPath: string) {
	rmSync(pidFilePath(socketPath), { force: true });
}

export function classifySocketError(error: NodeJS.ErrnoException | Error) {
	const errno = 'code' in error ? error.code : undefined;
	if (errno === 'ENOENT') {
		return {
			code: 'daemon_unavailable' as const,
			message: 'Treeseed key-agent socket is missing.',
		};
	}
	if (errno === 'EACCES' || errno === 'EPERM') {
		return {
			code: 'permission_denied' as const,
			message: 'Permission denied while connecting to the Treeseed key-agent socket.',
		};
	}
	if (errno === 'ECONNREFUSED' || errno === 'ECONNRESET') {
		return {
			code: 'daemon_unavailable' as const,
			message: 'Treeseed key-agent daemon is not accepting connections.',
		};
	}
	return {
		code: 'protocol_error' as const,
		message: error.message || 'Treeseed key-agent request failed.',
	};
}

export async function requestKeyAgentOverSocket(command: KeyAgentCommand, timeoutMs = KEY_AGENT_REQUEST_TIMEOUT_MS): Promise<KeyAgentResponse> {
	return new Promise((resolvePromise, rejectPromise) => {
		const socket = createConnection(command.socketPath);
		let responseBuffer = '';
		let settled = false;
		const finalize = (callback: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeoutHandle);
			socket.removeAllListeners();
			callback();
		};
		const timeoutHandle = setTimeout(() => {
			socket.destroy();
			rejectPromise(new KeyAgentError('daemon_unavailable', 'Timed out waiting for the Treeseed key-agent response.', {
				socketPath: command.socketPath,
			}));
		}, timeoutMs);
		socket.setEncoding('utf8');
		socket.on('connect', () => {
			socket.write(`${JSON.stringify(command)}\n`);
		});
		socket.on('data', (chunk) => {
			responseBuffer += chunk;
			const newlineIndex = responseBuffer.indexOf('\n');
			if (newlineIndex === -1) {
				return;
			}
			const payload = responseBuffer.slice(0, newlineIndex).trim();
			socket.end();
			try {
				const parsed = JSON.parse(payload || '{}') as KeyAgentResponse;
				finalize(() => resolvePromise(parsed));
			} catch (error) {
				finalize(() => rejectPromise(new KeyAgentError('protocol_error', 'Treeseed key-agent returned an invalid JSON response.', {
					socketPath: command.socketPath,
					cause: error instanceof Error ? error.message : String(error),
				})));
			}
		});
		socket.on('error', (error) => {
			const classified = classifySocketError(error);
			finalize(() => rejectPromise(new KeyAgentError(classified.code, classified.message, {
				socketPath: command.socketPath,
				cause: error.message,
			})));
		});
		socket.on('end', () => {
			if (!settled && responseBuffer.trim().length === 0) {
				finalize(() => rejectPromise(new KeyAgentError('protocol_error', 'Treeseed key-agent closed the connection without returning a response.', {
					socketPath: command.socketPath,
				})));
			}
		});
	});
}

export async function inspectKeyAgentDiagnostics(socketPath: string): Promise<KeyAgentDiagnostics> {
	const socketKind = detectSocketKind(socketPath);
	const diagnostics: KeyAgentDiagnostics = {
		socketPath,
		pidPath: pidFilePath(socketPath),
		socketPresent: socketKind !== 'missing',
		socketKind,
		socketConnectable: false,
		healthOk: false,
		daemonPid: readAgentPid(socketPath),
		lastError: null,
	};
	if (!diagnostics.socketPresent) {
		diagnostics.lastError = 'socket_missing';
		return diagnostics;
	}
	if (diagnostics.socketKind !== 'socket') {
		diagnostics.lastError = `stale_transport_${diagnostics.socketKind}`;
		return diagnostics;
	}
	try {
		const response = await requestKeyAgentOverSocket({
			command: 'health',
			keyPath: '',
			socketPath,
			idleTimeoutMs: KEY_AGENT_IDLE_TIMEOUT_MS,
		});
		diagnostics.socketConnectable = true;
		diagnostics.healthOk = response.ok;
		if (!response.ok) {
			diagnostics.lastError = response.message ?? response.code ?? 'health_failed';
		}
		return diagnostics;
	} catch (error) {
		const classified = classifySocketError(error instanceof Error ? error : new Error(String(error)));
		diagnostics.lastError = classified.message;
		return diagnostics;
	}
}

export function createStatus(command: KeyAgentCommand, session: KeyAgentSessionState): KeyAgentStatus {
	const wrapped = command.keyPath ? readWrappedMachineKeyFile(command.keyPath) : { exists: false, wrapped: null, migrationRequired: false };
	const idleRemainingMs = session.machineKey
		? Math.max(0, session.idleTimeoutMs - (Date.now() - session.lastTouchedAt))
		: 0;
	return {
		running: true,
		unlocked: Boolean(session.machineKey) && idleRemainingMs > 0,
		wrappedKeyPresent: wrapped.exists && Boolean(wrapped.wrapped),
		migrationRequired: Boolean(wrapped.migrationRequired),
		keyPath: command.keyPath,
		socketPath: command.socketPath,
		idleTimeoutMs: session.idleTimeoutMs,
		idleRemainingMs,
	};
}

export function maybeExpireSession(session: KeyAgentSessionState) {
	if (!session.machineKey) {
		return;
	}
	if (Date.now() - session.lastTouchedAt >= session.idleTimeoutMs) {
		session.machineKey = null;
	}
}
