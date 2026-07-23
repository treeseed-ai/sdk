import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TreeseedGuaranteeDiagnostic, TreeseedGuaranteeFilter, TreeseedGuaranteeRegistryReport, TreeseedGuaranteeStatus, TreeseedLoadedGuarantee, TreeseedLoadedGuaranteeVerifierRegistry } from './treeseed-guarantee-schema-version.ts';
import { filterTreeseedGuarantees, refs } from './build-treeseed-guarantee-dependency-graph.ts';
import { TreeseedGuaranteeRunStatus, TreeseedGuaranteeVerifierResolution, TreeseedGuaranteeVerifierResolutionReport, arrayOrEmpty, diagnostic, slugifyTreeseedGuaranteeJourney } from './treeseed-guarantee-journey-audit-item.ts';
import { csvEscape } from './plan-treeseed-guarantees.ts';
import { discoverTreeseedGuarantees } from './parse-verifier-registry.ts';
import { evidenceEnvSummary, runVerifierCommand } from './run-verifier-command.ts';

export function exportTreeseedGuaranteesCsv(input: { guarantees: TreeseedLoadedGuarantee[]; filter?: TreeseedGuaranteeFilter }) {
	const rows = filterTreeseedGuarantees({ guarantees: input.guarantees, filter: input.filter, includeDependencies: false });
	const header = [
		'Guarantee ID',
		'Journey Index',
		'Type',
		'Subtype',
		'Journey',
		'Owner Package',
		'Surface',
		'Status',
		'Dependencies',
		'Actor Roles',
		'Forbidden Roles',
		'Device Coverage',
		'Preconditions',
		'Scene Manifest',
		'API Verifier Refs',
		'Content Verifier Refs',
		'Audit Verifier Refs',
		'Negative Cases',
		'Release Gates',
		'Evidence Required',
		'Notes',
		'Source Path',
	];
	const body = rows.map((entry) => [
		entry.manifest.id,
		entry.manifest.journeyIndex ?? '',
		entry.manifest.type,
		entry.manifest.subtype,
		entry.manifest.journey,
		entry.manifest.ownerPackage,
		entry.manifest.surface ?? '',
		entry.manifest.status,
		[...arrayOrEmpty(entry.manifest.dependencies.guarantees), ...arrayOrEmpty(entry.manifest.dependencies.journeys).map((id) => `journey:${id}`)],
		entry.manifest.actors.allowed,
		entry.manifest.actors.forbidden,
		[...entry.manifest.devices.required, ...arrayOrEmpty(entry.manifest.devices.optional)],
		[...arrayOrEmpty(entry.manifest.preconditions.fixtures), ...arrayOrEmpty(entry.manifest.preconditions.notes)],
		entry.manifest.scene?.manifest ?? '',
		arrayOrEmpty(entry.manifest.api?.verifierRefs),
		arrayOrEmpty(entry.manifest.content?.verifierRefs),
		arrayOrEmpty(entry.manifest.audit?.verifierRefs),
		arrayOrEmpty(entry.manifest.negativeCases).map((negativeCase) => negativeCase.id),
		entry.manifest.gates,
		entry.manifest.evidence.required,
		arrayOrEmpty(entry.manifest.notes),
		entry.relativePath,
	]);
	return [header, ...body].map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

export function exportTreeseedGuaranteesJson(input: { registry: TreeseedGuaranteeRegistryReport; filter?: TreeseedGuaranteeFilter }) {
	return {
		schemaVersion: 'treeseed.guarantees.export/v1',
		generatedAt: new Date().toISOString(),
		workspaceRoot: input.registry.workspaceRoot,
		guarantees: filterTreeseedGuarantees({ guarantees: input.registry.guarantees, filter: input.filter, includeDependencies: false }).map((entry) => ({
			sourcePath: entry.relativePath,
			...entry.manifest,
		})),
	};
}

export function exportTreeseedGuaranteesMarkdown(input: { registry: TreeseedGuaranteeRegistryReport; filter?: TreeseedGuaranteeFilter }) {
	const rows = filterTreeseedGuarantees({ guarantees: input.registry.guarantees, filter: input.filter, includeDependencies: false });
	return [
		'# TreeSeed Guarantees',
		'',
		`Generated from ${rows.length} guarantee manifests.`,
		'',
		'| ID | Type | Subtype | Journey | Status | Gates |',
		'| --- | --- | --- | --- | --- | --- |',
		...rows.map((entry) => `| ${entry.manifest.id} | ${entry.manifest.type} | ${entry.manifest.subtype} | ${entry.manifest.journey.replace(/\|/gu, '\\|')} | ${entry.manifest.status} | ${entry.manifest.gates.join(', ')} |`),
		'',
	].join('\n');
}

export function writeTreeseedGuaranteesExport(input: { workspaceRoot: string; format: 'csv' | 'json' | 'markdown'; output: string; filter?: TreeseedGuaranteeFilter }) {
	const registry = discoverTreeseedGuarantees({ workspaceRoot: input.workspaceRoot, filter: input.filter });
	const outputPath = resolve(input.workspaceRoot, input.output);
	mkdirSync(dirname(outputPath), { recursive: true });
	const content = input.format === 'csv'
		? exportTreeseedGuaranteesCsv({ guarantees: registry.guarantees, filter: input.filter })
		: input.format === 'json'
			? `${JSON.stringify(exportTreeseedGuaranteesJson({ registry, filter: input.filter }), null, 2)}\n`
			: exportTreeseedGuaranteesMarkdown({ registry, filter: input.filter });
	writeFileSync(outputPath, content, 'utf8');
	return { ok: registry.ok, outputPath, registry };
}

export function verifierDefinitionsByRef(registries: TreeseedLoadedGuaranteeVerifierRegistry[]) {
	const definitions = new Map<string, TreeseedGuaranteeVerifierResolution>();
	for (const registry of registries) {
		for (const [ref, definition] of Object.entries(registry.registry?.verifiers ?? {})) {
			definitions.set(ref, {
				ref,
				resolved: true,
				sourcePath: registry.sourcePath,
				ownerPackage: definition.ownerPackage ?? registry.ownerPackage,
				definition: { ownerPackage: definition.ownerPackage ?? registry.ownerPackage, ...definition },
			});
		}
	}
	return definitions;
}

export function resolveTreeseedGuaranteeVerifierRefs(input: {
	refs: string[];
	verifierRegistries: TreeseedLoadedGuaranteeVerifierRegistry[];
	status?: TreeseedGuaranteeStatus;
	sourcePath?: string;
}): TreeseedGuaranteeVerifierResolutionReport {
	const diagnostics: TreeseedGuaranteeDiagnostic[] = [];
	const definitions = verifierDefinitionsByRef(input.verifierRegistries);
	const resolutions = [...new Set(input.refs)].map((ref) => {
		if (ref.startsWith('todo.')) {
			const severity = input.status === 'active' ? 'error' : 'warning';
			diagnostics.push(diagnostic(severity, 'guarantee.todo_verifier_ref', `Verifier ref "${ref}" is a placeholder.`, 'verifierRefs', input.sourcePath));
			return { ref, resolved: false };
		}
		const resolved = definitions.get(ref);
		if (resolved) return resolved;
		const severity = input.status === 'active' ? 'error' : 'warning';
		diagnostics.push(diagnostic(severity, 'guarantee.missing_verifier_ref', `Verifier ref "${ref}" is not defined.`, 'verifierRefs', input.sourcePath));
		return { ref, resolved: false };
	});
	return { ok: diagnostics.every((entry) => entry.severity !== 'error'), resolutions, diagnostics };
}

export function packageWorkspaceForOwner(ownerPackage: string) {
	if (ownerPackage === '@treeseed/market') return '.';
	const name = ownerPackage.replace(/^@treeseed\//u, '');
	return `packages/${name}`;
}

export function npmWorkspaceArgs(workspace: string, args: string[]) {
	return workspace === '.' ? args : ['-w', workspace, ...args];
}

export function relativeEvidencePath(workspaceRoot: string, path: string) {
	return relative(resolve(workspaceRoot), resolve(path)).replace(/\\/gu, '/');
}

export async function writeCommandEvidence(input: {
	workspaceRoot: string;
	outputRoot: string;
	ref: string;
	command: string;
	args: string[];
	cwd?: string;
	timeoutSeconds?: number;
	env?: Record<string, string | undefined>;
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
	validateSuccess?: (result: { stdout: string; stderr: string }) => string | null;
}) {
	const safeRef = slugifyTreeseedGuaranteeJourney(input.ref);
	const evidencePath = resolve(input.outputRoot, 'evidence', `${safeRef}.json`);
	mkdirSync(dirname(evidencePath), { recursive: true });
	const startedAt = new Date().toISOString();
	const cwd = input.cwd ? resolve(input.workspaceRoot, input.cwd) : resolve(input.workspaceRoot);
	const renderedCommand = [input.command, ...input.args].join(' ');
	input.onProgress?.(`[guarantees][verifier] ${input.ref}: running ${renderedCommand}`);
	try {
		const result = await runVerifierCommand({
			command: input.command,
			args: input.args,
			cwd,
			env: input.env ? { ...process.env, ...input.env } : process.env,
			timeoutMs: Math.max(1, input.timeoutSeconds ?? 300) * 1000,
			onProgress: input.onProgress,
			ref: input.ref,
		});
		const successError = input.validateSuccess?.(result);
		if (successError) {
			throw Object.assign(new Error(successError), { stdout: result.stdout, stderr: result.stderr, code: 1 });
		}
		const completedAt = new Date().toISOString();
		writeFileSync(evidencePath, `${JSON.stringify({
			ref: input.ref,
			command: input.command,
			args: input.args,
			cwd: input.cwd ?? '.',
			startedAt,
			completedAt,
			exitCode: 0,
			env: evidenceEnvSummary(input.env),
			stdout: result.stdout,
			stderr: result.stderr,
		}, null, 2)}\n`, 'utf8');
		input.onProgress?.(`[guarantees][verifier] ${input.ref}: passed`);
		return {
			status: 'passed' as TreeseedGuaranteeRunStatus,
			summary: `${input.ref} passed.`,
			evidence: [relativeEvidencePath(input.workspaceRoot, evidencePath)],
		};
	} catch (error) {
		const completedAt = new Date().toISOString();
		const commandError = error as Error & { stdout?: string; stderr?: string; code?: number | string };
		writeFileSync(evidencePath, `${JSON.stringify({
			ref: input.ref,
			command: input.command,
			args: input.args,
			cwd: input.cwd ?? '.',
			startedAt,
			completedAt,
			exitCode: commandError.code ?? 1,
			env: evidenceEnvSummary(input.env),
			stdout: commandError.stdout ?? '',
			stderr: commandError.stderr ?? '',
			error: commandError.message,
		}, null, 2)}\n`, 'utf8');
		input.onProgress?.(`[guarantees][verifier] ${input.ref}: failed - ${commandError.message}`, 'stderr');
		return {
			status: 'failed' as TreeseedGuaranteeRunStatus,
			summary: `${input.ref} failed.`,
			evidence: [relativeEvidencePath(input.workspaceRoot, evidencePath)],
			diagnostics: [diagnostic('error', 'guarantee.verifier_failed', commandError.message, input.ref)],
		};
	}
}

export function stripAnsi(value: string) {
	return value.replace(/\u001B\[[0-9;]*m/gu, '');
}

export function vitestExecutedAssertionCount(output: string) {
	const text = stripAnsi(output).replace(/\r\n/gu, '\n');
	const testsLine = text.split('\n').find((line) => /^\s*Tests\s+/u.test(line));
	if (!testsLine) return 0;
	const passed = [...testsLine.matchAll(/(\d+)\s+passed/gu)].reduce((total, match) => total + Number(match[1] ?? 0), 0);
	const failed = [...testsLine.matchAll(/(\d+)\s+failed/gu)].reduce((total, match) => total + Number(match[1] ?? 0), 0);
	return passed + failed;
}

export function validateTreeseedVitestVerifierOutput(result: { stdout: string; stderr: string }) {
	const output = `${result.stdout}\n${result.stderr}`;
	if (vitestExecutedAssertionCount(output) > 0) return null;
	return 'Vitest verifier completed without executing any assertions. Check the verifier testName/testFile; skipped-only or no-match runs are not valid guarantee evidence.';
}
