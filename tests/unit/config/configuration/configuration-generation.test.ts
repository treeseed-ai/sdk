import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureMachineConfiguration, readConfigurationGeneration, recordConfigurationGeneration, restoreMachineConfiguration, settleConfigurationGeneration } from '../../../../src/operations/services/config-runtime/configuration/configuration-generation.ts';

const roots: string[] = [];
function fixture() {
	const root = mkdtempSync(resolve(tmpdir(), 'configuration-generation-')); roots.push(root);
	const path = resolve(root, '.treeseed/config/machine.yaml'); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'version: one\n', { mode: 0o600 }); return { root, path };
}

describe('configuration generations', () => {
	afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
	it('records immutable candidates and atomically restores the previous working config', () => {
		const { root, path } = fixture(); const snapshot = captureMachineConfiguration(root);
		const first = recordConfigurationGeneration(root, ['local']);
		writeFileSync(path, 'version: invalid\n', { mode: 0o600 }); restoreMachineConfiguration(snapshot);
		expect(readFileSync(path, 'utf8')).toBe('version: one\n');
		expect(settleConfigurationGeneration(root, first.id, 'applied', { runtimeReady: true }).status).toBe('applied');
		expect(readConfigurationGeneration(root)?.configDigest).toBe(first.configDigest);
	});
});
