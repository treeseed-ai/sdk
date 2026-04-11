import { resolveAstroBin, createProductionBuildEnv, packageScriptPath, runNodeBinary, runNodeScript } from '../src/operations/services/runtime-tools.ts';

process.env.TREESEED_LOCAL_DEV_MODE = process.env.TREESEED_LOCAL_DEV_MODE ?? 'cloudflare';

runNodeScript(packageScriptPath('patch-starlight-content-path'), [], { cwd: process.cwd() });
runNodeScript(packageScriptPath('aggregate-book'), [], { cwd: process.cwd() });
runNodeBinary(resolveAstroBin(), ['build'], {
	cwd: process.cwd(),
	env: createProductionBuildEnv({
		TREESEED_LOCAL_DEV_MODE: process.env.TREESEED_LOCAL_DEV_MODE,
	}),
});
runNodeScript(packageScriptPath('build-tenant-worker'), [], {
	cwd: process.cwd(),
	env: createProductionBuildEnv({
		TREESEED_LOCAL_DEV_MODE: process.env.TREESEED_LOCAL_DEV_MODE,
	}),
});
