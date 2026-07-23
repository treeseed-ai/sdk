import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { accessSync, chmodSync, constants as fsConstants, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createConnection, createServer, type Server } from 'node:net';
import { ok } from './read-legacy-project-machine-key.ts';

export const TRESEED_MACHINE_KEY_PASSPHRASE_ENV = 'TREESEED_KEY_PASSPHRASE';

export const TRESEED_KEY_AGENT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export const TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS = TRESEED_KEY_AGENT_IDLE_TIMEOUT_MS;

export const TRESEED_WRAPPED_MACHINE_KEY_VERSION = 2;

export const TRESEED_WRAPPED_MACHINE_KEY_KIND = 'treeseed-wrapped-machine-key';

export const TREESEED_MACHINE_KEY_PASSPHRASE_ENV = TRESEED_MACHINE_KEY_PASSPHRASE_ENV;

export const KEY_AGENT_SOCKET_RELATIVE_PATH = '.treeseed/run/key-agent.sock';

export const KEY_AGENT_REQUEST_TIMEOUT_MS = 3000;

export const WRAPPED_KEY_KDF_PARAMS = {
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

export type TreeseedKeyAgentSessionState = {
	machineKey: Buffer | null;
	lastTouchedAt: number;
	idleTimeoutMs: number;
};

export function nowIso() {
	return new Date().toISOString();
}

export function ensureDirectory(path: string, mode = 0o700) {
	mkdirSync(path, { recursive: true, mode });
	chmodSync(path, mode);
}

export function ensureParent(filePath: string) {
	ensureDirectory(dirname(filePath), 0o700);
}

export function pidFilePath(socketPath: string) {
	return `${socketPath}.pid`;
}

export function detectSocketKind(socketPath: string): TreeseedKeyAgentDiagnostics['socketKind'] {
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

export function createFingerprint(machineKey: Buffer) {
	return machineKey.subarray(0, 6).toString('base64');
}

export function deriveWrappingKey(passphrase: string, salt: Buffer, keyLength: number) {
	return scryptSync(passphrase.normalize('NFKC'), salt, keyLength, {
		N: WRAPPED_KEY_KDF_PARAMS.N,
		r: WRAPPED_KEY_KDF_PARAMS.r,
		p: WRAPPED_KEY_KDF_PARAMS.p,
	});
}

export function wrapMachineKey(machineKey: Buffer, passphrase: string): TreeseedWrappedMachineKey {
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

export function isWrappedMachineKeyPayload(value: unknown): value is TreeseedWrappedMachineKey {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const record = value as Record<string, unknown>;
	return record.kind === TRESEED_WRAPPED_MACHINE_KEY_KIND && record.version === TRESEED_WRAPPED_MACHINE_KEY_VERSION;
}
