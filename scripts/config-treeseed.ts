#!/usr/bin/env node

import {
	applyTreeseedConfigValues,
	applyTreeseedSafeRepairs,
	collectTreeseedConfigContext,
	ensureTreeseedGitignoreEntries,
	finalizeTreeseedConfig,
	getTreeseedMachineConfigPaths,
	rotateTreeseedMachineKey,
} from '../src/operations/services/config-runtime.ts';

const tenantRoot = process.cwd();

function parseArgs(argv) {
	const parsed = {
		scopes: [],
		sync: 'all',
		systems: [],
		skipUnavailable: undefined,
		bootstrapExecution: 'parallel',
		bootstrap: false,
		rotateMachineKey: false,
	};

	const rest = [...argv];
	while (rest.length) {
		const current = rest.shift();
		if (!current) {
			continue;
		}
		if (current === '--environment') {
			parsed.scopes.push(rest.shift() ?? '');
			continue;
		}
		if (current.startsWith('--environment=')) {
			parsed.scopes.push(current.split('=', 2)[1] ?? '');
			continue;
		}
		if (current === '--sync') {
			parsed.sync = rest.shift() ?? 'all';
			continue;
		}
		if (current.startsWith('--sync=')) {
			parsed.sync = current.split('=', 2)[1] ?? 'all';
			continue;
		}
		if (current === '--bootstrap') {
			parsed.bootstrap = true;
			continue;
		}
		if (current === '--system') {
			parsed.systems.push(rest.shift() ?? '');
			continue;
		}
		if (current.startsWith('--system=')) {
			parsed.systems.push(current.split('=', 2)[1] ?? '');
			continue;
		}
		if (current === '--systems') {
			parsed.systems.push(...String(rest.shift() ?? '').split(','));
			continue;
		}
		if (current.startsWith('--systems=')) {
			parsed.systems.push(...String(current.split('=', 2)[1] ?? '').split(','));
			continue;
		}
		if (current === '--skip-unavailable') {
			parsed.skipUnavailable = true;
			continue;
		}
		if (current === '--bootstrap-sequential') {
			parsed.bootstrapExecution = 'sequential';
			continue;
		}
		if (current === '--rotate-machine-key') {
			parsed.rotateMachineKey = true;
			continue;
		}
		throw new Error(`Unknown config argument: ${current}`);
	}

	return parsed;
}

const options = parseArgs(process.argv.slice(2));
const scopes = options.scopes.length === 0 || options.scopes.includes('all')
	? ['local', 'staging', 'prod']
	: ['local', 'staging', 'prod'].filter((scope) => options.scopes.includes(scope));

ensureTreeseedGitignoreEntries(tenantRoot);

try {
	if (options.rotateMachineKey) {
		const result = rotateTreeseedMachineKey(tenantRoot);
		console.log('Treeseed machine key rotated.');
		console.log(`Machine key: ${result.keyPath}`);
	} else {
		applyTreeseedSafeRepairs(tenantRoot);
		const applyResult = options.bootstrap
			? { updated: [], sharedStorageMigrations: [] }
			: (() => {
				const context = collectTreeseedConfigContext({
					tenantRoot,
					scopes,
					env: process.env,
				});
				const updates = scopes.flatMap((scope) =>
					context.entriesByScope[scope].map((entry) => ({
						scope,
						entryId: entry.id,
						value: entry.effectiveValue,
						reused: entry.currentValue.length > 0 || entry.suggestedValue.length > 0,
					})),
				);
				return applyTreeseedConfigValues({ tenantRoot, updates });
			})();
		const result = await finalizeTreeseedConfig({
			tenantRoot,
			scopes,
			sync: options.sync,
			systems: options.systems.length > 0 ? options.systems : undefined,
			skipUnavailable: options.skipUnavailable,
			bootstrapExecution: options.bootstrapExecution,
			env: process.env,
		});
		const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);

		console.log(options.bootstrap ? 'Treeseed bootstrap completed.' : 'Treeseed config completed.');
		console.log(`Machine config: ${configPath}`);
		console.log(`Machine key: ${keyPath}`);
		console.log(`Updated values: ${applyResult.updated.length}`);
		console.log(`Reconciled environments: ${result.reconciled.length}`);
		for (const scope of scopes) {
			const readiness = result.readinessByScope?.[scope];
			if (!readiness) continue;
			const status = readiness.deployable ? 'deployable' : readiness.provisioned ? 'provisioned' : readiness.configured ? 'configured' : 'pending';
			console.log(`Readiness (${scope}): ${status}`);
		}
		if (result.synced.github) {
			console.log(
				`GitHub sync: ${result.synced.github.secrets.length} secrets, ${result.synced.github.variables.length} variables (${result.synced.github.repository})`,
			);
		}
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
