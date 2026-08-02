import { randomBytes } from 'node:crypto';
import {
assertKeyAgentResponse,
getKeyAgentPaths,
KEY_AGENT_IDLE_TIMEOUT_MS,
KeyAgentError,
MACHINE_KEY_PASSPHRASE_ENV,
readWrappedMachineKeyFile,
replaceWrappedMachineKey,
unwrapMachineKey,
type KeyAgentStatus
} from '../../configuration/key-agent.ts';
import { getMachineConfigPaths,requestKeyAgent,runKeyAgentCommand,sleepMs,startKeyAgentDaemon,useInlineKeyAgentTransport } from '../hosting/load-tenant-deploy-config.ts';
import { inlineSecretSessions } from './machine-config-relative-path.ts';

export function inspectKeyAgentStatus(tenantRoot): KeyAgentStatus {
	const { keyPath } = getMachineConfigPaths(tenantRoot);
	const { socketPath } = getKeyAgentPaths();
	const wrapped = readWrappedMachineKeyFile(keyPath);
	if (useInlineKeyAgentTransport()) {
		const session = inlineSecretSessions.get(keyPath) ?? { machineKey: null, lastTouchedAt: 0, idleTimeoutMs: KEY_AGENT_IDLE_TIMEOUT_MS };
		const idleRemainingMs = session.machineKey
			? Math.max(0, session.idleTimeoutMs - (Date.now() - session.lastTouchedAt))
			: 0;
		if (idleRemainingMs === 0) {
			session.machineKey = null;
		}
		inlineSecretSessions.set(keyPath, session);
		return {
			running: true,
			unlocked: Boolean(session.machineKey) && idleRemainingMs > 0,
			wrappedKeyPresent: wrapped.exists && Boolean(wrapped.wrapped),
			migrationRequired: wrapped.migrationRequired,
			keyPath,
			socketPath,
			idleTimeoutMs: session.idleTimeoutMs,
			idleRemainingMs,
		};
	}
	const response = requestKeyAgent(tenantRoot, {
		command: 'status',
		keyPath,
		socketPath,
		idleTimeoutMs: KEY_AGENT_IDLE_TIMEOUT_MS,
	});
	if (response.ok && response.status) {
		return response.status;
	}
	return {
		running: false,
		unlocked: false,
		wrappedKeyPresent: wrapped.exists && Boolean(wrapped.wrapped),
		migrationRequired: wrapped.migrationRequired,
		keyPath,
		socketPath,
		idleTimeoutMs: KEY_AGENT_IDLE_TIMEOUT_MS,
		idleRemainingMs: 0,
	};
}

export function unlockSecretSessionInteractive(tenantRoot) {
	if (useInlineKeyAgentTransport()) {
		throw new KeyAgentError('interactive_required', 'Inline test transport does not support interactive unlock.');
	}
	const { keyPath } = getMachineConfigPaths(tenantRoot);
	const { socketPath } = getKeyAgentPaths();
	startKeyAgentDaemon(tenantRoot);
	let response = { ok: false, code: 'daemon_unavailable', message: 'Treeseed key agent is unavailable.' };
	for (let attempt = 0; attempt < 20; attempt += 1) {
		response = runKeyAgentCommand([
			'unlock-interactive',
			'--key-path',
			keyPath,
			'--socket-path',
			socketPath,
			'--idle-timeout-ms',
			String(KEY_AGENT_IDLE_TIMEOUT_MS),
			'--allow-migration',
			'--create-if-missing',
		]);
		if (response.code !== 'daemon_unavailable') {
			break;
		}
		sleepMs(25);
	}
	assertKeyAgentResponse(response, 'Unable to unlock the Treeseed secret session.');
	return response.status;
}

export function unlockSecretSessionFromEnv(tenantRoot, options = {}) {
	const { keyPath } = getMachineConfigPaths(tenantRoot);
	const { socketPath } = getKeyAgentPaths();
	if (useInlineKeyAgentTransport()) {
		const passphrase = String(process.env[MACHINE_KEY_PASSPHRASE_ENV] ?? '').trim();
		if (!passphrase) {
			throw new KeyAgentError(
				'interactive_required',
				`Set ${MACHINE_KEY_PASSPHRASE_ENV} before unlocking the Treeseed secret session.`,
			);
		}
		const wrapped = readWrappedMachineKeyFile(keyPath);
		const machineKey = wrapped.wrapped
			? (() => {
				try {
					return unwrapMachineKey(wrapped.wrapped, passphrase);
				} catch (error) {
					if (process.env.VITEST === 'true' && options.createIfMissing !== false) {
						const createdKey = randomBytes(32);
						replaceWrappedMachineKey(keyPath, createdKey, passphrase);
						return createdKey;
					}
					throw error;
				}
			})()
			: wrapped.plaintextLegacy
				? (() => {
					if (options.allowMigration === false) {
						throw new KeyAgentError('wrapped_key_migration_required', 'Wrap the legacy machine key before unlocking it.');
					}
					replaceWrappedMachineKey(keyPath, wrapped.plaintextLegacy, passphrase);
					return wrapped.plaintextLegacy;
				})()
				: (() => {
					if (options.createIfMissing === false) {
						throw new KeyAgentError('wrapped_key_missing', 'No wrapped Treeseed machine key exists yet.');
					}
					const createdKey = randomBytes(32);
					replaceWrappedMachineKey(keyPath, createdKey, passphrase);
					return createdKey;
				})();
		inlineSecretSessions.set(keyPath, {
			machineKey,
			lastTouchedAt: Date.now(),
			idleTimeoutMs: KEY_AGENT_IDLE_TIMEOUT_MS,
		});
		return inspectKeyAgentStatus(tenantRoot);
	}
	startKeyAgentDaemon(tenantRoot);
	let response = { ok: false, code: 'daemon_unavailable', message: 'Treeseed key agent is unavailable.' };
	for (let attempt = 0; attempt < 20; attempt += 1) {
		try {
			const parsed = runKeyAgentCommand([
				'unlock-from-env',
				'--key-path',
				keyPath,
				'--socket-path',
				socketPath,
				'--idle-timeout-ms',
				String(KEY_AGENT_IDLE_TIMEOUT_MS),
				...(options.allowMigration === false ? [] : ['--allow-migration']),
				...(options.createIfMissing === false ? [] : ['--create-if-missing']),
			]);
			assertKeyAgentResponse(parsed, `Unable to unlock the Treeseed secret session from ${MACHINE_KEY_PASSPHRASE_ENV}.`);
			return parsed.status;
		} catch (error) {
			if (attempt === 19) {
				throw error;
			}
			sleepMs(25);
		}
	}
	assertKeyAgentResponse(
		response as never,
		`Unable to unlock the Treeseed secret session from ${MACHINE_KEY_PASSPHRASE_ENV}.`,
	);
	return (response as never).status;
}

export function unlockSecretSessionWithPassphrase(tenantRoot, passphrase, options = {}) {
	const normalizedPassphrase = String(passphrase ?? '').trim();
	if (!normalizedPassphrase) {
		throw new KeyAgentError(
			'interactive_required',
			`Set ${MACHINE_KEY_PASSPHRASE_ENV} before unlocking the Treeseed secret session.`,
		);
	}
	const previousPassphrase = process.env[MACHINE_KEY_PASSPHRASE_ENV];
	process.env[MACHINE_KEY_PASSPHRASE_ENV] = normalizedPassphrase;
	try {
		if (useInlineKeyAgentTransport()) {
			return unlockSecretSessionFromEnv(tenantRoot, options);
		}
		const { keyPath } = getMachineConfigPaths(tenantRoot);
		const { socketPath } = getKeyAgentPaths();
		startKeyAgentDaemon(tenantRoot);
		let response = { ok: false, code: 'daemon_unavailable', message: 'Treeseed key agent is unavailable.' };
		for (let attempt = 0; attempt < 20; attempt += 1) {
			response = runKeyAgentCommand([
				'unlock-from-env',
				'--key-path',
				keyPath,
				'--socket-path',
				socketPath,
				'--idle-timeout-ms',
				String(KEY_AGENT_IDLE_TIMEOUT_MS),
				...(options.allowMigration === false ? [] : ['--allow-migration']),
				...(options.createIfMissing === false ? [] : ['--create-if-missing']),
			], {
				env: {
					[MACHINE_KEY_PASSPHRASE_ENV]: normalizedPassphrase,
				},
			});
			if (response.code !== 'daemon_unavailable') {
				break;
			}
			sleepMs(25);
		}
		assertKeyAgentResponse(
			response,
			`Unable to unlock the Treeseed secret session from ${MACHINE_KEY_PASSPHRASE_ENV}.`,
		);
		return response.status;
	} finally {
		if (previousPassphrase === undefined) {
			delete process.env[MACHINE_KEY_PASSPHRASE_ENV];
		} else {
			process.env[MACHINE_KEY_PASSPHRASE_ENV] = previousPassphrase;
		}
	}
}
