import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { GuaranteeDiagnostic, GuaranteeManifest } from './guarantee-schema-version.ts';
import { GuaranteeVerifierExecutionInput, GuaranteeVerifierExecutionResult, arrayOrEmpty, diagnostic, isRecord } from './guarantee-journey-audit-item.ts';
import { sceneHasAcceptanceAssertions } from './plan-guarantees.ts';
import { npmWorkspaceArgs, packageWorkspaceForOwner, validateVitestVerifierOutput, writeCommandEvidence } from './export-guarantees-csv.ts';

export function runVerifierCommand(input: {
	command: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
	ref: string;
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
}): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(input.command, input.args, {
			cwd: input.cwd,
			env: input.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			input.onProgress?.(`[guarantees][verifier] ${input.ref}: timed out after ${Math.round(input.timeoutMs / 1000)}s`, 'stderr');
			child.kill('SIGTERM');
			setTimeout(() => {
				if (!settled) child.kill('SIGKILL');
			}, 2_000).unref();
		}, input.timeoutMs);
		timer.unref();
		child.stdout.on('data', (chunk: Buffer) => {
			const text = chunk.toString();
			stdout += text;
			for (const line of text.split(/\r?\n/u)) {
				if (line.trim()) input.onProgress?.(`[guarantees][verifier][stdout] ${input.ref}: ${line}`);
			}
		});
		child.stderr.on('data', (chunk: Buffer) => {
			const text = chunk.toString();
			stderr += text;
			for (const line of text.split(/\r?\n/u)) {
				if (line.trim()) input.onProgress?.(`[guarantees][verifier][stderr] ${input.ref}: ${line}`, 'stderr');
			}
		});
		child.on('error', (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(Object.assign(error, { stdout, stderr }));
		});
		child.on('close', (code, signal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (code === 0) {
				resolvePromise({ stdout, stderr });
				return;
			}
			const message = signal
				? `${input.command} ${input.args.join(' ')} exited with signal ${signal}`
				: `${input.command} ${input.args.join(' ')} exited with code ${code ?? 1}`;
			reject(Object.assign(new Error(message), { stdout, stderr, code: code ?? signal ?? 1 }));
		});
	});
}

export function evidenceEnvSummary(env?: Record<string, string | undefined>) {
	if (!env) return undefined;
	return Object.fromEntries(Object.entries(env).map(([key, value]) => [
		key,
		/SECRET|TOKEN|KEY|PASSWORD/iu.test(key) && value ? '<redacted>' : value,
	]));
}

export function sceneActionKindFromManifestAction(action: unknown) {
	if (!action || typeof action !== 'object') return 'unknown';
	const keys = Object.keys(action as Record<string, unknown>);
	return keys[0] ?? 'unknown';
}

export function validateGuaranteeSceneJourneyContract(input: { scenePath: string; sourcePath?: string }): GuaranteeDiagnostic[] {
	const diagnostics: GuaranteeDiagnostic[] = [];
	let value: unknown = null;
	try {
		value = parseYaml(readFileSync(input.scenePath, 'utf8'));
	} catch (error) {
		diagnostics.push(diagnostic('error', 'guarantee.scene_unreadable', error instanceof Error ? error.message : String(error ?? 'Scene manifest could not be read.'), 'scene.manifest', input.sourcePath));
		return diagnostics;
	}
	if (!value || typeof value !== 'object') {
		diagnostics.push(diagnostic('error', 'guarantee.scene_invalid_manifest', 'Scene manifest must be an object.', 'scene.manifest', input.sourcePath));
		return diagnostics;
	}
	const workflow = Array.isArray((value as { workflow?: unknown }).workflow) ? (value as { workflow: unknown[] }).workflow : [];
	if (workflow.length === 0) {
		diagnostics.push(diagnostic('error', 'guarantee.scene_empty_journey', 'Active scene guarantee has no workflow steps.', 'scene.workflow', input.sourcePath));
		return diagnostics;
	}
	const journey = isRecord((value as Record<string, unknown>).journey) ? (value as { journey: Record<string, unknown> }).journey : null;
	const minimumSteps = typeof journey?.minimumSteps === 'number' ? journey.minimumSteps : 2;
	if (journey?.kind !== 'service') {
		diagnostics.push(diagnostic('error', 'guarantee.scene_missing_service_journey', 'Scene-backed active guarantees must declare journey.kind: service so evidence is tied to a service journey contract.', 'scene.journey.kind', input.sourcePath));
	}
	const actionKinds = workflow.map((step) => sceneActionKindFromManifestAction((step as { action?: unknown } | null)?.action));
	const interactiveActions = actionKinds.filter((kind) => kind !== 'goto' && kind !== 'pause');
	if (workflow.length < minimumSteps || interactiveActions.length === 0) {
		diagnostics.push(diagnostic(
			'error',
			'guarantee.scene_weak_journey_contract',
			`Scene workflow has ${workflow.length} step${workflow.length === 1 ? '' : 's'} (${actionKinds.join(', ')}). A service journey guarantee must exercise user/service actions after opening the entry route, so evidence captures the actual journey instead of only the first page.`,
			'scene.workflow',
			input.sourcePath,
		));
	}
	for (const [index, step] of workflow.entries()) {
		if (!sceneHasAcceptanceAssertions(step)) {
			diagnostics.push(diagnostic('error', 'guarantee.scene_step_missing_assertions', `Workflow step ${index + 1} is missing acceptance assertions.`, `scene.workflow[${index}].expect`, input.sourcePath));
		}
	}
	return diagnostics;
}

export function apiAcceptanceEnvironment(environment: string) {
	const baseUrl = apiAcceptanceBaseUrl(environment);
	const serviceId = process.env.TREESEED_ACCEPTANCE_SERVICE_ID
		?? process.env.TREESEED_API_WEB_SERVICE_ID
		?? process.env.TREESEED_WEB_SERVICE_ID
		?? (environment === 'local' ? 'web' : undefined);
	const serviceSecret = process.env.TREESEED_ACCEPTANCE_SERVICE_SECRET
		?? process.env.TREESEED_API_WEB_SERVICE_SECRET
		?? process.env.TREESEED_WEB_SERVICE_SECRET
		?? (environment === 'local' ? 'treeseed-web-service-dev-secret' : undefined);
	return {
		TREESEED_ACCEPTANCE_ENVIRONMENT: environment,
		TREESEED_API_BASE_URL: baseUrl,
		TREESEED_ACCEPTANCE_SERVICE_ID: serviceId,
		TREESEED_ACCEPTANCE_SERVICE_SECRET: serviceSecret,
	};
}

export function apiAcceptanceBaseUrl(environment: string) {
	if (process.env.TREESEED_API_BASE_URL?.trim()) {
		const configured = process.env.TREESEED_API_BASE_URL.trim().replace(/\/+$/u, '');
		if (environment !== 'local' && isLoopbackUrl(configured)) {
			throw new Error(`API guarantee environment ${environment} must target a live hosted API URL, not ${configured}.`);
		}
		return configured;
	}
	if (environment === 'staging') return 'https://api.preview.treeseed.dev';
	if (environment === 'prod') return 'https://api.treeseed.dev';
	return 'http://127.0.0.1:3000';
}

export function isLoopbackUrl(value: string) {
	try {
		const url = new URL(value);
		return ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(url.hostname);
	} catch {
		return false;
	}
}

export async function defaultGuaranteeVerifierExecutor(input: GuaranteeVerifierExecutionInput): Promise<GuaranteeVerifierExecutionResult> {
	const definition = input.definition;
	const ownerPackage = definition.ownerPackage ?? input.guarantee.manifest.ownerPackage;
	const workspace = packageWorkspaceForOwner(ownerPackage);
	if (definition.kind === 'todo') {
		return {
			status: 'blocked',
			summary: `${input.ref} is a todo verifier.`,
			diagnostics: [diagnostic('error', 'guarantee.todo_verifier_execution', `Verifier ref "${input.ref}" is not executable.`, input.ref, input.guarantee.sourcePath)],
		};
	}
	if (definition.kind === 'manualEvidence') {
		return { status: 'skipped', summary: `${input.ref} requires manual evidence.`, evidence: arrayOrEmpty(definition.evidence) };
	}
	if (definition.kind === 'scene') {
		return { status: 'passed', summary: `${input.ref} is covered by the guarantee scene step.`, evidence: arrayOrEmpty(definition.evidence) };
	}
	if (definition.kind === 'apiAcceptanceCase') {
		if (!definition.caseId) {
			return { status: 'blocked', summary: `${input.ref} missing caseId.`, diagnostics: [diagnostic('error', 'guarantee.api_verifier_missing_case_id', `API verifier "${input.ref}" is missing caseId.`, input.ref, input.guarantee.sourcePath)] };
		}
		return writeCommandEvidence({
			workspaceRoot: input.workspaceRoot,
			outputRoot: input.outputRoot,
			ref: input.ref,
			command: 'npm',
			args: ['-w', 'packages/api', 'run', 'test:acceptance', '--', '--environment', input.environment, '--base-url', apiAcceptanceBaseUrl(input.environment), '--case', definition.caseId, '--json'],
			timeoutSeconds: definition.timeoutSeconds,
			env: apiAcceptanceEnvironment(input.environment),
			onProgress: input.onProgress,
		});
	}
	if (definition.kind === 'vitestCase') {
		if (!definition.testFile) {
			return { status: 'blocked', summary: `${input.ref} missing testFile.`, diagnostics: [diagnostic('error', 'guarantee.vitest_verifier_missing_test_file', `Vitest verifier "${input.ref}" is missing testFile.`, input.ref, input.guarantee.sourcePath)] };
		}
		return writeCommandEvidence({
			workspaceRoot: input.workspaceRoot,
			outputRoot: input.outputRoot,
			ref: input.ref,
			command: 'npm',
			args: npmWorkspaceArgs(workspace, ['exec', '--', 'vitest', 'run', definition.testFile, ...(definition.testName ? ['-t', definition.testName] : [])]),
			timeoutSeconds: definition.timeoutSeconds,
			onProgress: input.onProgress,
			validateSuccess: validateVitestVerifierOutput,
		});
	}
	if (definition.kind === 'packageScript') {
		if (!definition.command) {
			return { status: 'blocked', summary: `${input.ref} missing command.`, diagnostics: [diagnostic('error', 'guarantee.package_script_missing_command', `Package script verifier "${input.ref}" is missing command.`, input.ref, input.guarantee.sourcePath)] };
		}
		return writeCommandEvidence({
			workspaceRoot: input.workspaceRoot,
			outputRoot: input.outputRoot,
			ref: input.ref,
			command: 'npm',
			args: npmWorkspaceArgs(workspace, ['run', definition.command, '--', ...arrayOrEmpty(definition.args)]),
			timeoutSeconds: definition.timeoutSeconds,
			onProgress: input.onProgress,
		});
	}
	if (definition.kind === 'nodeScript') {
		if (!definition.command) {
			return { status: 'blocked', summary: `${input.ref} missing command.`, diagnostics: [diagnostic('error', 'guarantee.node_script_missing_command', `Node script verifier "${input.ref}" is missing command.`, input.ref, input.guarantee.sourcePath)] };
		}
		return writeCommandEvidence({
			workspaceRoot: input.workspaceRoot,
			outputRoot: input.outputRoot,
			ref: input.ref,
			command: 'node',
			args: ['--import', 'tsx', definition.command, ...arrayOrEmpty(definition.args)],
			cwd: definition.cwd,
			timeoutSeconds: definition.timeoutSeconds,
			onProgress: input.onProgress,
		});
	}
	return {
		status: 'blocked',
		summary: `${input.ref} has unsupported verifier kind.`,
		diagnostics: [diagnostic('error', 'guarantee.unsupported_verifier_kind', `Unsupported verifier kind "${definition.kind}".`, input.ref, input.guarantee.sourcePath)],
	};
}

export function sceneAuthRoleForGuarantee(manifest: GuaranteeManifest) {
	if (manifest.actors.allowed.includes('anonymous_user') || manifest.actors.allowed.includes('anonymous')) return undefined;
	const actors = manifest.actors.allowed.map((actor) => actor.toLowerCase());
	if (actors.some((actor) => /owner|operator|seller|platform|host/iu.test(actor))) return 'owner';
	if (actors.some((actor) => /admin|manager|lead/iu.test(actor))) return 'admin';
	if (actors.some((actor) => /member|contributor|authenticated|participant|viewer/iu.test(actor))) return 'member';
	return 'owner';
}

export function browserForGuaranteeDevice(device: string | undefined) {
	if (device?.includes('firefox')) return 'firefox';
	if (device?.includes('webkit')) return 'webkit';
	return 'chromium';
}

export function sceneDeviceRunsForGuarantee(devices: string[]) {
	const requested = devices.length > 0 ? devices : ['desktop_chromium'];
	return requested.map((device) => ({
		id: device.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-'),
		device,
		browser: browserForGuaranteeDevice(device),
	}));
}
