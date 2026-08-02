import { timingSafeEqual } from 'node:crypto';
import { rmSync } from 'node:fs';
import { readLegacyProjectMachineKey } from './read-legacy-project-machine-key.ts';
import { replaceWrappedMachineKey } from './read-wrapped-machine-key-file.ts';
import { KeyAgentError } from './treseed-machine-key-passphrase-env.ts';

export function migrateLegacyProjectMachineKeyToWrapped(keyPath: string, legacyKeyPath: string, passphrase: string) {
	const legacyProjectKey = readLegacyProjectMachineKey(legacyKeyPath);
	if (!legacyProjectKey) {
		throw new KeyAgentError(
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
