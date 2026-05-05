import { resolve } from 'node:path';
import { runLocalD1Migrations } from '../src/operations/services/d1-migration.ts';
import { createPersistentDeployTarget, ensureGeneratedWranglerConfig } from '../src/operations/services/deploy.ts';

const tenantRoot = process.cwd();
const migrationsRoot = resolve(tenantRoot, 'migrations');
const { wranglerPath: wranglerConfig } = ensureGeneratedWranglerConfig(tenantRoot, {
	target: createPersistentDeployTarget('local'),
	env: process.env,
});

runLocalD1Migrations({
	cwd: tenantRoot,
	wranglerConfig,
	migrationsRoot,
});
