import { applyTreeseedEnvironmentToProcess, writeTreeseedLocalEnvironmentFiles } from '../src/operations/services/config-runtime.ts';

const tenantRoot = process.cwd();
applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'local', override: true });
const result = writeTreeseedLocalEnvironmentFiles(tenantRoot);
console.log(`Wrote ${result.envLocalPath}`);
console.log(`Wrote ${result.devVarsPath}`);
