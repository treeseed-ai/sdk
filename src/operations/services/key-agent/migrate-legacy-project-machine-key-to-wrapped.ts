import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { accessSync, chmodSync, constants as fsConstants, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createConnection, createServer, type Server } from 'node:net';
import { readLegacyProjectMachineKey } from './read-legacy-project-machine-key.ts';
import { TreeseedKeyAgentError } from './treseed-machine-key-passphrase-env.ts';
import { replaceWrappedMachineKey } from './read-wrapped-machine-key-file.ts';

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
