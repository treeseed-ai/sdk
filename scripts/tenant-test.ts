import { packageScriptPath, runNodeScript } from '../src/operations/services/runtime-tools.ts';

runNodeScript(packageScriptPath('tenant-check'), [], {
	cwd: process.cwd(),
});
