import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDevLogs } from '../../../local-dev/managed-dev.ts';
import { sceneWarningDiagnostic } from './diagnostics.ts';
import type { SceneLogCollectOptions, SceneLogReport } from '../../types.ts';

const MAX_BYTES = 1024 * 1024;
const MAX_LINES = 1000;

function tail(content: string) {
	const bytes = Buffer.from(content, 'utf8');
	const clipped = bytes.length > MAX_BYTES ? bytes.subarray(bytes.length - MAX_BYTES).toString('utf8') : content;
	const lines = clipped.split(/\r?\n/u);
	return lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES).join('\n') : clipped;
}

function writeIfContent(path: string, content: string) {
	writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
	return path;
}

export function collectSceneLogs(input: SceneLogCollectOptions): SceneLogReport {
	const diagnostics = [];
	const logs: Record<string, string | null> = {
		dev: input.artifacts.devLogPath ?? null,
		api: input.artifacts.apiLogPath ?? null,
		operationsRunner: input.artifacts.operationsRunnerLogPath ?? null,
	};
	try {
		const devLogs = readDevLogs({ cwd: input.projectRoot, surfaces: 'web,api,operations-runner' }).logs;
		const byId = new Map(devLogs.map((entry) => [entry.id, entry]));
		const web = byId.get('web');
		const api = byId.get('api');
		const runner = byId.get('operations-runner');
		if (web && input.artifacts.devLogPath) writeIfContent(input.artifacts.devLogPath, tail(web.content));
		if (api && input.artifacts.apiLogPath) writeIfContent(input.artifacts.apiLogPath, tail(api.content));
		if (runner && input.artifacts.operationsRunnerLogPath) writeIfContent(input.artifacts.operationsRunnerLogPath, tail(runner.content));
		for (const [id, entry] of [['web', web], ['api', api], ['operations-runner', runner]] as const) {
			if (!entry?.content) diagnostics.push(sceneWarningDiagnostic('scene.logs_unavailable', `No managed dev log content was available for ${id}.`, 'logs'));
		}
	} catch (error) {
		diagnostics.push(sceneWarningDiagnostic('scene.log_collect_failed', error instanceof Error ? error.message : String(error ?? 'Log collection failed.'), 'logs'));
	}
	for (const [key, path] of Object.entries(logs)) {
		if (path && !existsSync(path)) writeIfContent(path, '');
		logs[key] = path;
	}
	return { ok: true, logs, diagnostics };
}
