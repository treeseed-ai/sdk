import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { accessSync, chmodSync, constants as fsConstants, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createConnection, createServer, type Server } from 'node:net';

export const TRESEED_MACHINE_KEY_PASSPHRASE_ENV = 'TREESEED_KEY_PASSPHRASE';
export const TRESEED_KEY_AGENT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS = TRESEED_KEY_AGENT_IDLE_TIMEOUT_MS;
export const TRESEED_WRAPPED_MACHINE_KEY_VERSION = 2;
export const TRESEED_WRAPPED_MACHINE_KEY_KIND = 'treeseed-wrapped-machine-key';
export const TREESEED_MACHINE_KEY_PASSPHRASE_ENV = TRESEED_MACHINE_KEY_PASSPHRASE_ENV;

const KEY_AGENT_SOCKET_RELATIVE_PATH = '.treeseed/run/key-agent.sock';
const KEY_AGENT_REQUEST_TIMEOUT_MS = 3000;
const WRAPPED_KEY_KDF_PARAMS = {
	N: 1 << 14,
	r: 8,
	p: 1,
	keyLength: 32,
};

export type TreeseedWrappedMachineKey = {
	version: 2;
	kind: typeof TRESEED_WRAPPED_MACHINE_KEY_KIND;
	createdAt: string;
	updatedAt: string;
	kdf: {
		algorithm: 'scrypt';
		salt: string;
		N: number;
		r: number;
		p: number;
		keyLength: number;
	};
	wrappedKey: {
		algorithm: 'aes-256-gcm';
		iv: string;
		tag: string;
		ciphertext: string;
	};
	fingerprint: string;
};

export type TreeseedKeyAgentStatus = {
	running: boolean;
	unlocked: boolean;
	wrappedKeyPresent: boolean;
	migrationRequired: boolean;
	keyPath: string;
	socketPath: string;
	idleTimeoutMs: number;
	idleRemainingMs: number;
};

export type TreeseedKeyAgentDiagnostics = {
	socketPath: string;
	pidPath: string;
	socketPresent: boolean;
	socketKind: 'missing' | 'socket' | 'fifo' | 'file' | 'directory' | 'other';
	socketConnectable: boolean;
	healthOk: boolean;
	daemonPid: number | null;
	lastError: string | null;
};

export type TreeseedKeyAgentCommand =
	| { command: 'health'; keyPath: string; socketPath: string; idleTimeoutMs: number }
	| { command: 'status'; keyPath: string; socketPath: string; idleTimeoutMs: number }
	| { command: 'unlock'; keyPath: string; socketPath: string; idleTimeoutMs: number; passphrase: string; createIfMissing?: boolean; allowMigration?: boolean }
	| { command: 'lock'; keyPath: string; socketPath: string; idleTimeoutMs: number }
	| { command: 'touch'; keyPath: string; socketPath: string; idleTimeoutMs: number }
	| { command: 'get-machine-key'; keyPath: string; socketPath: string; idleTimeoutMs: number };

export type TreeseedKeyAgentResponse = {
	ok: boolean;
	code?: string;
	message?: string;
	status?: TreeseedKeyAgentStatus;
	machineKey?: string;
	diagnostics?: TreeseedKeyAgentDiagnostics;
};

export class TreeseedKeyAgentError extends Error {
	code: 'locked' | 'unlock_required' | 'unlock_failed' | 'wrapped_key_missing' | 'wrapped_key_migration_required' | 'interactive_required' | 'daemon_unavailable' | 'corrupt_wrapped_key' | 'permission_denied' | 'protocol_error';
	details?: Record<string, unknown>;

	constructor(
		code: TreeseedKeyAgentError['code'],
		message: string,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.name = 'TreeseedKeyAgentError';
		this.code = code;
		this.details = details;
	}
}

type TreeseedKeyAgentSessionState = {
	machineKey: Buffer | null;
	lastTouchedAt: number;
	idleTimeoutMs: number;
};

function nowIso() {
	return new Date().toISOString();
}

function ensureDirectory(path: string, mode = 0o700) {
	mkdirSync(path, { recursive: true, mode });
	chmodSync(path, mode);
}

function ensureParent(filePath: string) {
	ensureDirectory(dirname(filePath), 0o700);
}

function pidFilePath(socketPath: string) {
	return `${socketPath}.pid`;
}

function detectSocketKind(socketPath: string): TreeseedKeyAgentDiagnostics['socketKind'] {
	if (!existsSync(socketPath)) {
		return 'missing';
	}
	try {
		const stats = lstatSync(socketPath);
		if (stats.isSocket()) {
			return 'socket';
		}
		if (stats.isFIFO()) {
			return 'fifo';
		}
		if (stats.isFile()) {
			return 'file';
		}
		if (stats.isDirectory()) {
			return 'directory';
		}
		return 'other';
	} catch {
		return 'other';
	}
}

function createFingerprint(machineKey: Buffer) {
	return machineKey.subarray(0, 6).toString('base64');
}

function deriveWrappingKey(passphrase: string, salt: Buffer, keyLength: number) {
	return scryptSync(passphrase.normalize('NFKC'), salt, keyLength, {
		N: WRAPPED_KEY_KDF_PARAMS.N,
		r: WRAPPED_KEY_KDF_PARAMS.r,
		p: WRAPPED_KEY_KDF_PARAMS.p,
	});
}

function wrapMachineKey(machineKey: Buffer, passphrase: string): TreeseedWrappedMachineKey {
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const wrappingKey = deriveWrappingKey(passphrase, salt, WRAPPED_KEY_KDF_PARAMS.keyLength);
	const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
	const ciphertext = Buffer.concat([cipher.update(machineKey), cipher.final()]);
	const tag = cipher.getAuthTag();
	return {
		version: TRESEED_WRAPPED_MACHINE_KEY_VERSION,
		kind: TRESEED_WRAPPED_MACHINE_KEY_KIND,
		createdAt: nowIso(),
		updatedAt: nowIso(),
		kdf: {
			algorithm: 'scrypt',
			salt: salt.toString('base64'),
			N: WRAPPED_KEY_KDF_PARAMS.N,
			r: WRAPPED_KEY_KDF_PARAMS.r,
			p: WRAPPED_KEY_KDF_PARAMS.p,
			keyLength: WRAPPED_KEY_KDF_PARAMS.keyLength,
		},
		wrappedKey: {
			algorithm: 'aes-256-gcm',
			iv: iv.toString('base64'),
			tag: tag.toString('base64'),
			ciphertext: ciphertext.toString('base64'),
		},
		fingerprint: createFingerprint(machineKey),
	};
}

export function unwrapMachineKey(payload: TreeseedWrappedMachineKey, passphrase: string) {
	try {
		const salt = Buffer.from(payload.kdf.salt, 'base64');
		const wrappingKey = deriveWrappingKey(passphrase, salt, payload.kdf.keyLength);
		const decipher = createDecipheriv('aes-256-gcm', wrappingKey, Buffer.from(payload.wrappedKey.iv, 'base64'));
		decipher.setAuthTag(Buffer.from(payload.wrappedKey.tag, 'base64'));
		return Buffer.concat([
			decipher.update(Buffer.from(payload.wrappedKey.ciphertext, 'base64')),
			decipher.final(),
		]);
	} catch (error) {
		throw new TreeseedKeyAgentError(
			'unlock_failed',
			'Unable to unlock the Treeseed machine key. The passphrase is incorrect or the wrapped key file is corrupt.',
			{ cause: error instanceof Error ? error.message : String(error) },
		);
	}
}

function isWrappedMachineKeyPayload(value: unknown): value is TreeseedWrappedMachineKey {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const record = value as Record<string, unknown>;
	return record.kind === TRESEED_WRAPPED_MACHINE_KEY_KIND && record.version === TRESEED_WRAPPED_MACHINE_KEY_VERSION;
}

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
		throw new TreeseedKeyAgentError(
			'corrupt_wrapped_key',
			'Unable to parse the Treeseed machine key file.',
			{ keyPath },
		);
	}
}

export function writeWrappedMachineKeyFile(keyPath: string, payload: TreeseedWrappedMachineKey) {
	ensureParent(keyPath);
	writeFileSync(keyPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

export function replaceWrappedMachineKey(keyPath: string, machineKey: Buffer, passphrase: string) {
	const payload = wrapMachineKey(machineKey, passphrase);
	writeWrappedMachineKeyFile(keyPath, payload);
	return payload;
}

function resolveRuntimeRoot() {
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

export function getTreeseedKeyAgentPaths() {
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

function readAgentPid(socketPath: string) {
	const pidPath = pidFilePath(socketPath);
	if (!existsSync(pidPath)) {
		return null;
	}
	const raw = readFileSync(pidPath, 'utf8').trim();
	const pid = Number.parseInt(raw, 10);
	return Number.isFinite(pid) ? pid : null;
}

function writePidFile(socketPath: string) {
	ensureParent(socketPath);
	writeFileSync(pidFilePath(socketPath), `${process.pid}\n`, { mode: 0o600 });
}

function clearPidFile(socketPath: string) {
	rmSync(pidFilePath(socketPath), { force: true });
}

function classifySocketError(error: NodeJS.ErrnoException | Error) {
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

async function requestTreeseedKeyAgentOverSocket(command: TreeseedKeyAgentCommand, timeoutMs = KEY_AGENT_REQUEST_TIMEOUT_MS): Promise<TreeseedKeyAgentResponse> {
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
			rejectPromise(new TreeseedKeyAgentError('daemon_unavailable', 'Timed out waiting for the Treeseed key-agent response.', {
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
				const parsed = JSON.parse(payload || '{}') as TreeseedKeyAgentResponse;
				finalize(() => resolvePromise(parsed));
			} catch (error) {
				finalize(() => rejectPromise(new TreeseedKeyAgentError('protocol_error', 'Treeseed key-agent returned an invalid JSON response.', {
					socketPath: command.socketPath,
					cause: error instanceof Error ? error.message : String(error),
				})));
			}
		});
		socket.on('error', (error) => {
			const classified = classifySocketError(error);
			finalize(() => rejectPromise(new TreeseedKeyAgentError(classified.code, classified.message, {
				socketPath: command.socketPath,
				cause: error.message,
			})));
		});
		socket.on('end', () => {
			if (!settled && responseBuffer.trim().length === 0) {
				finalize(() => rejectPromise(new TreeseedKeyAgentError('protocol_error', 'Treeseed key-agent closed the connection without returning a response.', {
					socketPath: command.socketPath,
				})));
			}
		});
	});
}

export async function inspectTreeseedKeyAgentDiagnostics(socketPath: string): Promise<TreeseedKeyAgentDiagnostics> {
	const socketKind = detectSocketKind(socketPath);
	const diagnostics: TreeseedKeyAgentDiagnostics = {
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
		const response = await requestTreeseedKeyAgentOverSocket({
			command: 'health',
			keyPath: '',
			socketPath,
			idleTimeoutMs: TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS,
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

function createStatus(command: TreeseedKeyAgentCommand, session: TreeseedKeyAgentSessionState): TreeseedKeyAgentStatus {
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

function maybeExpireSession(session: TreeseedKeyAgentSessionState) {
	if (!session.machineKey) {
		return;
	}
	if (Date.now() - session.lastTouchedAt >= session.idleTimeoutMs) {
		session.machineKey = null;
	}
}

function readLegacyProjectMachineKey(legacyKeyPath: string) {
	if (!existsSync(legacyKeyPath)) {
		return null;
	}
	try {
		return Buffer.from(readFileSync(legacyKeyPath, 'utf8').trim(), 'base64');
	} catch {
		return null;
	}
}

function unwrapOrProvisionMachineKey(command: Extract<TreeseedKeyAgentCommand, { command: 'unlock' }>) {
	const wrapped = readWrappedMachineKeyFile(command.keyPath);
	if (wrapped.wrapped) {
		return unwrapMachineKey(wrapped.wrapped, command.passphrase);
	}
	if (wrapped.plaintextLegacy) {
		if (!command.allowMigration) {
			throw new TreeseedKeyAgentError(
				'wrapped_key_migration_required',
				'The Treeseed machine key is still stored in the legacy plaintext format. Run a migration or unlock interactively to wrap it first.',
				{ keyPath: command.keyPath },
			);
		}
		replaceWrappedMachineKey(command.keyPath, wrapped.plaintextLegacy, command.passphrase);
		return wrapped.plaintextLegacy;
	}
	if (!command.createIfMissing) {
		throw new TreeseedKeyAgentError(
			'wrapped_key_missing',
			'No wrapped Treeseed machine key exists yet. Create one by unlocking interactively or with a startup passphrase.',
			{ keyPath: command.keyPath },
		);
	}
	const machineKey = randomBytes(32);
	replaceWrappedMachineKey(command.keyPath, machineKey, command.passphrase);
	return machineKey;
}

function ok(response: Omit<TreeseedKeyAgentResponse, 'ok'> = {}): TreeseedKeyAgentResponse {
	return { ok: true, ...response };
}

function fail(error: unknown, command: TreeseedKeyAgentCommand): TreeseedKeyAgentResponse {
	const wrappedState = command.keyPath ? readWrappedMachineKeyFile(command.keyPath) : { wrapped: null, migrationRequired: false };
	if (error instanceof TreeseedKeyAgentError) {
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

export function handleTreeseedKeyAgentCommand(
	command: TreeseedKeyAgentCommand,
	session: TreeseedKeyAgentSessionState,
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
			return fail(new TreeseedKeyAgentError('locked', 'Treeseed secret session is locked.'), command);
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
		return fail(new TreeseedKeyAgentError('locked', 'Treeseed secret session is locked.'), command);
	}
	session.lastTouchedAt = Date.now();
	return ok({
		status: createStatus(command, session),
		machineKey: session.machineKey.toString('base64'),
	});
}

export async function requestTreeseedKeyAgent(command: TreeseedKeyAgentCommand): Promise<TreeseedKeyAgentResponse> {
	const diagnostics = await inspectTreeseedKeyAgentDiagnostics(command.socketPath);
	if (!diagnostics.healthOk && command.command !== 'health') {
		throw new TreeseedKeyAgentError('daemon_unavailable', diagnostics.lastError ?? 'Treeseed key-agent is not running.', { diagnostics });
	}
	return requestTreeseedKeyAgentOverSocket(command);
}

async function socketAlreadyServed(socketPath: string) {
	const diagnostics = await inspectTreeseedKeyAgentDiagnostics(socketPath);
	return diagnostics.socketConnectable && diagnostics.healthOk;
}

async function removeStaleSocket(socketPath: string) {
	if (!existsSync(socketPath)) {
		return true;
	}
	const socketKind = detectSocketKind(socketPath);
	if (socketKind !== 'socket') {
		rmSync(socketPath, { force: true });
		clearPidFile(socketPath);
		return true;
	}
	const diagnostics = await inspectTreeseedKeyAgentDiagnostics(socketPath);
	if (diagnostics.socketConnectable && diagnostics.healthOk) {
		return false;
	}
	rmSync(socketPath, { force: true });
	clearPidFile(socketPath);
	return true;
}

export async function startTreeseedKeyAgentServer(options: {
	keyPath: string;
	socketPath?: string;
	idleTimeoutMs?: number;
}) {
	const socketPath = options.socketPath ?? getTreeseedKeyAgentPaths().socketPath;
	const canStart = await removeStaleSocket(socketPath);
	if (!canStart) {
		return;
	}
	ensureParent(socketPath);

	const session: TreeseedKeyAgentSessionState = {
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
			let response: TreeseedKeyAgentResponse;
			try {
				const parsed = JSON.parse(line) as TreeseedKeyAgentCommand;
				response = handleTreeseedKeyAgentCommand(parsed, session);
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

export function assertTreeseedKeyAgentResponse(response: TreeseedKeyAgentResponse, fallback = 'Treeseed secret session request failed.') {
	if (response.ok) {
		return response;
	}
	throw new TreeseedKeyAgentError(
		(response.code as TreeseedKeyAgentError['code']) ?? 'unlock_failed',
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

export function migrateLegacyProjectMachineKeyToWrapped(keyPath: string, legacyKeyPath: string, passphrase: string) {
	const legacyProjectKey = readLegacyProjectMachineKey(legacyKeyPath);
	if (!legacyProjectKey) {
		throw new TreeseedKeyAgentError(
			'wrapped_key_migration_required',
			'No legacy project machine key is available to migrate.',
			{ legacyKeyPath },
		);
	}
	const wrapped = replaceWrappedMachineKey(keyPath, legacyProjectKey, passphrase);
	if (legacyKeyPath !== keyPath) {
		rmSync(legacyKeyPath, { force: true });
	}
	return wrapped;
}

export function machineKeysEqual(left: Buffer, right: Buffer) {
	return left.length === right.length && timingSafeEqual(left, right);
}
