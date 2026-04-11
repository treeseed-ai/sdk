import { resolveAstroBin, createProductionBuildEnv, packageScriptPath, runNodeBinary, runNodeScript } from '../src/operations/services/runtime-tools.ts';

runNodeScript(packageScriptPath('patch-starlight-content-path'), [], { cwd: process.cwd() });
runNodeScript(packageScriptPath('aggregate-book'), [], { cwd: process.cwd() });
runNodeBinary(resolveAstroBin(), ['check'], {
	cwd: process.cwd(),
	env: createProductionBuildEnv(),
});
