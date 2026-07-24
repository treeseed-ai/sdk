import { packageScriptPath, runNodeScript } from '../../src/operations/services/agents/runtime-tools.ts';

runNodeScript(packageScriptPath('verification/tenant-check'), [], {
	cwd: process.cwd(),
});
