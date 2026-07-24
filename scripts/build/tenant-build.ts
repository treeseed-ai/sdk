import { spawnSync } from 'node:child_process';
import { createBuildWarningSummary, formatAllowedBuildWarnings } from '../../src/operations/services/build/build-warning-policy.ts';
import { resolveAstroBin, createProductionBuildEnv, packageScriptPath, runNodeBinary, runNodeScript } from '../../src/operations/services/agents/runtime-tools.ts';

function runFilteredNodeBinary(binPath: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
	const result = spawnSync(process.execPath, [binPath, ...args], {
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		stdio: 'pipe',
		encoding: 'utf8',
	});
	const warningSummary = createBuildWarningSummary();
	const emitFiltered = (text: string, stream: NodeJS.WriteStream) => {
		for (const line of text.split(/\r?\n/u)) {
			if (!line) continue;
			const classified = warningSummary.record(line);
			if (classified.kind === 'allowed') continue;
			stream.write(`${line}\n`);
		}
	};
	emitFiltered(result.stdout ?? '', process.stdout);
	emitFiltered(result.stderr ?? '', process.stderr);
	for (const line of formatAllowedBuildWarnings(warningSummary.allowedWarnings)) {
		process.stdout.write(`${line}\n`);
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

process.env.LOCAL_DEV_MODE = process.env.LOCAL_DEV_MODE ?? 'cloudflare';
const publishedRuntime = process.env.TREESEED_CONTENT_SERVING_MODE === 'published_runtime';

runNodeScript(packageScriptPath('content/patch-starlight-content-path'), [], { cwd: process.cwd() });
if (!publishedRuntime) {
	runNodeScript(packageScriptPath('content/aggregate-book'), [], { cwd: process.cwd() });
}
runFilteredNodeBinary(resolveAstroBin(), ['build'], {
	cwd: process.cwd(),
	env: createProductionBuildEnv({
		LOCAL_DEV_MODE: process.env.LOCAL_DEV_MODE,
	}),
});
runNodeScript(packageScriptPath('build/build-tenant-worker'), [], {
	cwd: process.cwd(),
	env: createProductionBuildEnv({
		LOCAL_DEV_MODE: process.env.LOCAL_DEV_MODE,
	}),
});
