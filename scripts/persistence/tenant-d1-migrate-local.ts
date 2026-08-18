import { runLocalD1Migrations } from '../../src/operations/services/persistence/d1-migration.ts';
import { createPersistentDeployTarget, ensureGeneratedWranglerConfig } from '../../src/operations/services/hosting/deployment/deploy.ts';
import { sdkD1MigrationsRoot } from '../../src/operations/services/runtime/runtime-paths.ts';

const tenantRoot = process.cwd();
const { wranglerPath: wranglerConfig } = ensureGeneratedWranglerConfig(tenantRoot, {
	target: createPersistentDeployTarget('local'),
	env: process.env,
});

runLocalD1Migrations({
	cwd: tenantRoot,
	wranglerConfig,
	migrationsRoot: sdkD1MigrationsRoot,
	persistTo: process.env.TREESEED_API_D1_LOCAL_PERSIST_TO?.trim() || undefined,
});

process.exit(0);
