import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { isTreeseedEnvironmentEntryRelevant, isTreeseedEnvironmentEntryRequired } from '../../platform/environment.ts';
import { getGitHubAutomationMode, maybeResolveGitHubRepositorySlug } from './github-automation.ts';
import { createGitHubApiClient, listGitHubEnvironmentSecretNames, listGitHubEnvironmentVariableNames } from './github-api.ts';
import { collectInternalDevReferenceIssues } from './package-reference-policy.ts';
import { collectTreeseedEnvironmentContext, resolveTreeseedMachineEnvironmentValues, validateTreeseedCommandEnvironment } from './config-runtime.ts';
import { loadDeployState } from './deploy.ts';
import { loadCliDeployConfig } from './runtime-tools.ts';
import { packagesWithScript, run, workspacePackages } from './workspace-tools.ts';

export type ReleaseCandidateStatus = 'passed' | 'failed';

export type ReleaseCandidateFailure = {
	code: string;
	scope: string;
	provider?: string | null;
	message: string;
	details?: Record<string, unknown> | null;
};

export type ReleaseCandidateFingerprint = {
	key: string;
	rootSha: string | null;
	packageShas: Record<string, string | null>;
	plannedVersions: Record<string, string>;
	lockfiles: Record<string, string | null>;
	selectedPackages: string[];
};

export type ReleaseCandidateCheck = {
	name: string;
	status: 'passed' | 'skipped' | 'failed';
	detail: string;
};

export type ReleaseCandidateReport = {
	status: ReleaseCandidateStatus;
	fingerprint: ReleaseCandidateFingerprint;
	reused: boolean;
	checkedAt: string;
	failures: ReleaseCandidateFailure[];
	checks: ReleaseCandidateCheck[];
};

export type ReleaseCandidateInput = {
	root: string;
	plannedVersions: Record<string, unknown>;
	selectedPackageNames?: string[];
	allowReuse?: boolean;
};

const RELEASE_CANDIDATE_CACHE_DIR = '.treeseed/workflow/release-candidates';
const STABLE_SEMVER = /^\d+\.\d+\.\d+$/u;
const REHEARSAL_IGNORED_SEGMENTS = new Set([
	'.git',
	'.treeseed',
	'.wrangler',
	'.astro',
	'coverage',
	'dist',
	'node_modules',
]);

function nowIso() {
	return new Date().toISOString();
}

function sortedRecord<T>(record: Record<string, T>) {
	return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right))) as Record<string, T>;
}

function sha256(value: string) {
	return createHash('sha256').update(value).digest('hex');
}

function fileSha256(filePath: string) {
	if (!existsSync(filePath)) return null;
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function safeGitHead(repoDir: string) {
	try {
		return run('git', ['rev-parse', 'HEAD'], { cwd: repoDir, capture: true }).trim();
	} catch {
		return null;
	}
}

function safePackageJson(filePath: string) {
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function writeJsonFile(filePath: string, value: Record<string, unknown>) {
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function packageScripts(filePath: string) {
	const packageJson = safePackageJson(filePath);
	return packageJson?.scripts && typeof packageJson.scripts === 'object' && !Array.isArray(packageJson.scripts)
		? packageJson.scripts as Record<string, unknown>
		: {};
}

function releaseCandidateCachePath(root: string, key: string) {
	return resolve(root, RELEASE_CANDIDATE_CACHE_DIR, `${key}.json`);
}

function ensureReleaseCandidateCacheDir(root: string) {
	const dir = resolve(root, RELEASE_CANDIDATE_CACHE_DIR);
	mkdirSync(dir, { recursive: true });
	const gitignorePath = resolve(root, '.treeseed', 'workflow', '.gitignore');
	mkdirSync(dirname(gitignorePath), { recursive: true });
	if (!existsSync(gitignorePath)) {
		writeFileSync(gitignorePath, '*\n!.gitignore\n!runs/\nruns/*\n!runs/.gitignore\n', 'utf8');
	}
	return dir;
}

export function buildReleaseCandidateFingerprint(input: ReleaseCandidateInput): ReleaseCandidateFingerprint {
	const selectedPackages = [...new Set((input.selectedPackageNames ?? []).map(String))].sort();
	const selectedPackageSet = new Set(selectedPackages);
	const packages = workspacePackages(input.root)
		.filter((pkg) => typeof pkg.name === 'string' && pkg.name.startsWith('@treeseed/'));
	const packageShas = sortedRecord(Object.fromEntries(
		packages.map((pkg) => [pkg.name, safeGitHead(pkg.dir)]),
	));
	const plannedVersions = sortedRecord(Object.fromEntries(
		Object.entries(input.plannedVersions)
			.filter(([name]) => name === '@treeseed/market' || selectedPackageSet.has(name))
			.map(([name, version]) => [name, String(version)]),
	));
	const lockfiles = sortedRecord({
		'@treeseed/market': fileSha256(resolve(input.root, 'package-lock.json')),
		...Object.fromEntries(packages.map((pkg) => [pkg.name, fileSha256(resolve(pkg.dir, 'package-lock.json'))])),
	});
	const base = {
		rootSha: safeGitHead(input.root),
		packageShas,
		plannedVersions,
		lockfiles,
		selectedPackages,
	};
	return {
		...base,
		key: sha256(JSON.stringify(base)),
	};
}

export function readCachedReleaseCandidateReport(root: string, key: string) {
	const cachePath = releaseCandidateCachePath(root, key);
	if (!existsSync(cachePath)) return null;
	try {
		return JSON.parse(readFileSync(cachePath, 'utf8')) as ReleaseCandidateReport;
	} catch {
		return null;
	}
}

export function writeReleaseCandidateReport(root: string, report: ReleaseCandidateReport) {
	ensureReleaseCandidateCacheDir(root);
	writeFileSync(releaseCandidateCachePath(root, report.fingerprint.key), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	return report;
}

function addFailure(failures: ReleaseCandidateFailure[], failure: ReleaseCandidateFailure) {
	failures.push({
		...failure,
		details: failure.details ?? null,
		provider: failure.provider ?? null,
	});
}

function packageReadinessChecks(root: string, selectedPackageNames: string[], failures: ReleaseCandidateFailure[]): ReleaseCandidateCheck {
	if (selectedPackageNames.length === 0) {
		return { name: 'package-release-readiness', status: 'skipped', detail: 'No packages are selected for this release.' };
	}
	if (getGitHubAutomationMode() === 'stub') {
		return { name: 'package-release-readiness', status: 'skipped', detail: 'GitHub automation is stubbed.' };
	}
	const selected = new Set(selectedPackageNames);
	const packages = workspacePackages(root).filter((pkg) => selected.has(pkg.name));
	for (const pkg of packages) {
		const packageJson = safePackageJson(resolve(pkg.dir, 'package.json'));
		const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object' && !Array.isArray(packageJson.scripts)
			? packageJson.scripts as Record<string, unknown>
			: {};
		if (!existsSync(resolve(pkg.dir, '.github', 'workflows', 'publish.yml'))) {
			addFailure(failures, {
				code: 'missing_publish_workflow',
				scope: pkg.name,
				provider: 'github',
				message: `${pkg.name} is missing .github/workflows/publish.yml.`,
			});
		}
		if (typeof scripts['release:publish'] !== 'string') {
			addFailure(failures, {
				code: 'missing_publish_script',
				scope: pkg.name,
				message: `${pkg.name} is missing a release:publish script.`,
			});
		}
		if (typeof scripts['verify:local'] !== 'string' && typeof scripts['verify'] !== 'string' && typeof scripts['verify:action'] !== 'string') {
			addFailure(failures, {
				code: 'missing_verify_script',
				scope: pkg.name,
				message: `${pkg.name} is missing a release-ready verify script.`,
			});
		}
		try {
			run('npm', ['pack', '--dry-run'], { cwd: pkg.dir, capture: true, timeoutMs: 120000 });
		} catch (error) {
			addFailure(failures, {
				code: 'npm_pack_dry_run_failed',
				scope: pkg.name,
				message: `${pkg.name} failed npm pack --dry-run.`,
				details: { error: error instanceof Error ? error.message : String(error) },
			});
		}
	}
	return {
		name: 'package-release-readiness',
		status: failures.some((failure) => failure.code.startsWith('missing_') || failure.code === 'npm_pack_dry_run_failed') ? 'failed' : 'passed',
		detail: `Checked ${packages.length} selected package${packages.length === 1 ? '' : 's'}.`,
	};
}

function copyWorkspaceForProductionRehearsal(root: string) {
	const tempParent = mkdtempSync(join(tmpdir(), 'treeseed-release-candidate-'));
	const tempRoot = join(tempParent, 'workspace');
	cpSync(root, tempRoot, {
		recursive: true,
		filter: (source) => {
			const rel = relative(root, source);
			if (!rel) return true;
			const segments = rel.split(/[\\/]+/u);
			return !segments.some((segment) => REHEARSAL_IGNORED_SEGMENTS.has(segment));
		},
	});
	return { tempParent, tempRoot };
}

function applyPlannedStableMetadata(root: string, plannedVersions: Record<string, string>) {
	const stableVersions = new Map(
		Object.entries(plannedVersions).filter(([, version]) => STABLE_SEMVER.test(version)),
	);
	const targets = [
		{ name: '@treeseed/market', dir: root },
		...workspacePackages(root).map((pkg) => ({ name: pkg.name, dir: pkg.dir })),
	];
	for (const target of targets) {
		const packageJsonPath = resolve(target.dir, 'package.json');
		const packageJson = safePackageJson(packageJsonPath);
		if (!packageJson) continue;
		let changed = false;
		const plannedVersion = stableVersions.get(target.name);
		if (plannedVersion && packageJson.version !== plannedVersion) {
			packageJson.version = plannedVersion;
			changed = true;
		}
		for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
			const values = packageJson[field];
			if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
			for (const [dependencyName, version] of stableVersions.entries()) {
				if (!(dependencyName in values)) continue;
				if (String((values as Record<string, unknown>)[dependencyName]) === version) continue;
				(values as Record<string, unknown>)[dependencyName] = version;
				changed = true;
			}
		}
		if (changed) {
			writeJsonFile(packageJsonPath, packageJson);
		}
	}
}

function rehearsalVerifyScript(root: string) {
	const scripts = packageScripts(resolve(root, 'package.json'));
	for (const scriptName of ['verify:direct', 'verify:local', 'verify', 'build']) {
		if (typeof scripts[scriptName] === 'string') {
			return scriptName;
		}
	}
	return null;
}

function buildRehearsalWorkspacePackageArtifacts(root: string) {
	for (const pkg of packagesWithScript('build:dist', root)) {
		run('npm', ['--prefix', pkg.dir, 'run', 'build:dist'], { cwd: root, timeoutMs: 300000 });
	}
}

function runProductionDependencyRehearsal(
	root: string,
	plannedVersions: Record<string, string>,
	selectedPackageNames: string[],
	failures: ReleaseCandidateFailure[],
) {
	if (getGitHubAutomationMode() === 'stub' || process.env.TREESEED_RELEASE_CANDIDATE_REHEARSAL_MODE === 'skip') {
		return 'Skipped clean install rehearsal in stub/skip mode.';
	}
	const selectedPackageSet = new Set(selectedPackageNames);
	let tempParent: string | null = null;
	try {
		const copied = copyWorkspaceForProductionRehearsal(root);
		tempParent = copied.tempParent;
		applyPlannedStableMetadata(copied.tempRoot, plannedVersions);
		run('npm', ['install', '--package-lock-only', '--ignore-scripts'], { cwd: copied.tempRoot, timeoutMs: 300000 });
		run('npm', ['ci', '--ignore-scripts'], { cwd: copied.tempRoot, timeoutMs: 600000 });
		buildRehearsalWorkspacePackageArtifacts(copied.tempRoot);
		const scriptName = rehearsalVerifyScript(copied.tempRoot);
		if (scriptName) {
			run('npm', ['run', scriptName], { cwd: copied.tempRoot, timeoutMs: 900000 });
		}
		const postInstallIssues = collectInternalDevReferenceIssues(copied.tempRoot, selectedPackageSet);
		if (postInstallIssues.length > 0) {
			addFailure(failures, {
				code: 'internal_dev_references_after_rehearsal',
				scope: '@treeseed/market',
				message: 'Production dependency rehearsal still found internal dev references after clean install.',
				details: {
					references: postInstallIssues.map((issue) => ({
						filePath: issue.filePath,
						field: issue.field,
						dependencyName: issue.dependencyName,
						spec: issue.spec,
						reason: issue.reason,
					})),
				},
			});
		}
		return scriptName
			? `Ran clean install and npm run ${scriptName} in a temporary production rehearsal workspace.`
			: 'Ran clean install in a temporary production rehearsal workspace.';
	} catch (error) {
		addFailure(failures, {
			code: 'production_dependency_rehearsal_failed',
			scope: '@treeseed/market',
			message: 'Production dependency rehearsal failed in the temporary workspace.',
			details: { error: error instanceof Error ? error.message : String(error) },
		});
		return 'Production dependency rehearsal failed.';
	} finally {
		if (tempParent) {
			rmSync(tempParent, { recursive: true, force: true });
		}
	}
}

function dependencyRehearsalChecks(
	root: string,
	plannedVersions: Record<string, string>,
	selectedPackageNames: string[],
	failures: ReleaseCandidateFailure[],
): ReleaseCandidateCheck {
	const before = failures.length;
	for (const [name, version] of Object.entries(plannedVersions)) {
		if ((name === '@treeseed/market' || selectedPackageNames.includes(name)) && !STABLE_SEMVER.test(version)) {
			addFailure(failures, {
				code: 'unstable_planned_version',
				scope: name,
				message: `${name} planned release version is not stable semver: ${version}.`,
			});
		}
	}
	const selectedPackageSet = new Set(selectedPackageNames);
	const devReferenceIssues = collectInternalDevReferenceIssues(root);
	const unrehearsableDevReferences = devReferenceIssues.filter((issue) => {
		const dependencyName = issue.dependencyName ?? '';
		const planned = plannedVersions[dependencyName];
		return !selectedPackageSet.has(dependencyName) || !planned || !STABLE_SEMVER.test(planned);
	});
	if (unrehearsableDevReferences.length > 0) {
		addFailure(failures, {
			code: 'internal_dev_references',
			scope: '@treeseed/market',
			message: 'Production dependency rehearsal found internal dev references without a stable planned replacement.',
			details: {
				references: unrehearsableDevReferences.map((issue) => ({
					filePath: issue.filePath,
					field: issue.field,
					dependencyName: issue.dependencyName,
					spec: issue.spec,
					reason: issue.reason,
				})),
			},
		});
	}
	const rehearsalDetail = unrehearsableDevReferences.length === 0 && failures.length === before
		? runProductionDependencyRehearsal(root, plannedVersions, selectedPackageNames, failures)
		: 'Skipped clean install rehearsal because stable dependency metadata is incomplete.';
	return {
		name: 'production-dependency-rehearsal',
		status: failures.length > before ? 'failed' : 'passed',
		detail: `${devReferenceIssues.length > 0
			? `Rehearsed stable replacements for ${devReferenceIssues.length} internal dev reference${devReferenceIssues.length === 1 ? '' : 's'}.`
			: 'Checked planned stable versions and internal dependency references.'} ${rehearsalDetail}`,
	};
}

function localConfigCheck(root: string, scope: 'staging' | 'prod', failures: ReleaseCandidateFailure[]) {
	try {
		const report = validateTreeseedCommandEnvironment({ tenantRoot: root, scope, purpose: 'deploy' });
		const problems = [...report.validation.missing, ...report.validation.invalid];
		for (const problem of problems) {
			addFailure(failures, {
				code: 'missing_local_config',
				scope,
				provider: problem.entry.group ?? 'config',
				message: `${scope} deploy config is missing or invalid: ${problem.id}.`,
				details: { key: problem.id, provider: problem.entry.group ?? null },
			});
		}
	} catch (error) {
		addFailure(failures, {
			code: 'config_validation_failed',
			scope,
			provider: 'config',
			message: `${scope} deploy config could not be validated.`,
			details: { error: error instanceof Error ? error.message : String(error) },
		});
	}
}

async function githubRemoteConfigCheck(root: string, scope: 'staging' | 'prod', failures: ReleaseCandidateFailure[]) {
	if (getGitHubAutomationMode() === 'stub') {
		return;
	}
	const repository = maybeResolveGitHubRepositorySlug(root);
	if (!repository) {
		addFailure(failures, {
			code: 'missing_github_repository',
			scope,
			provider: 'github',
			message: `${scope} GitHub config parity could not determine the repository from origin.`,
		});
		return;
	}
	try {
		const environment = scope === 'prod' ? 'production' : scope;
		const expected = expectedGitHubDeployEnvironment(root, scope);
		const client = createGitHubApiClient();
		const [secretNames, variableNames] = await Promise.all([
			listGitHubEnvironmentSecretNames(repository, environment, { client }),
			listGitHubEnvironmentVariableNames(repository, environment, { client }),
		]);
		const missingSecrets = expected.secrets.filter((key: string) => !secretNames.has(key));
		const missingVariables = expected.variables.filter((key: string) => !variableNames.has(key));
		for (const key of missingSecrets) {
			addFailure(failures, {
				code: 'missing_remote_config',
				scope,
				provider: 'github-secret',
				message: `${scope} GitHub secret is missing: ${key}.`,
				details: { key, provider: 'github-secret', repository, environment },
			});
		}
		for (const key of missingVariables) {
			addFailure(failures, {
				code: 'missing_remote_config',
				scope,
				provider: 'github-variable',
				message: `${scope} GitHub variable is missing: ${key}.`,
				details: { key, provider: 'github-variable', repository, environment },
			});
		}
	} catch (error) {
		addFailure(failures, {
			code: 'remote_config_check_failed',
			scope,
			provider: 'github',
			message: `${scope} GitHub config parity check failed.`,
			details: { error: error instanceof Error ? error.message : String(error) },
		});
	}
}

function expectedGitHubDeployEnvironment(root: string, scope: 'staging' | 'prod') {
	const registry = collectTreeseedEnvironmentContext(root);
	const values = resolveTreeseedMachineEnvironmentValues(root, scope);
	const expectedEntries = registry.entries.filter((entry) => {
		if (!isTreeseedEnvironmentEntryRelevant(entry, registry.context, scope, 'deploy')) return false;
		if (isTreeseedEnvironmentEntryRequired(entry, registry.context, scope, 'deploy')) return true;
		return typeof values[entry.id] === 'string' && values[entry.id].trim().length > 0;
	});
	return {
		secrets: [...new Set(expectedEntries.filter((entry) => entry.targets.includes('github-secret')).map((entry) => entry.id))],
		variables: [...new Set(expectedEntries.filter((entry) => entry.targets.includes('github-variable')).map((entry) => entry.id))],
	};
}

function providerResourceIdentifierCheck(root: string, scope: 'staging' | 'prod', failures: ReleaseCandidateFailure[]) {
	try {
		const deployConfig = loadCliDeployConfig(root);
		const state = loadDeployState(root, deployConfig, { scope });
		const siteDataDb = state.d1Databases?.SITE_DATA_DB;
		if (!siteDataDb?.databaseName || !siteDataDb?.databaseId) {
			addFailure(failures, {
				code: 'missing_remote_resource_identifier',
				scope,
				provider: 'cloudflare-d1',
				message: `${scope} Cloudflare D1 SITE_DATA_DB is missing a database name or id.`,
				details: { resource: 'SITE_DATA_DB', required: ['databaseName', 'databaseId'] },
			});
		}
		const services = state.services && typeof state.services === 'object' && !Array.isArray(state.services)
			? state.services as Record<string, Record<string, unknown>>
			: {};
		for (const [serviceKey, service] of Object.entries(services)) {
			if ((service.provider ?? 'railway') !== 'railway') continue;
			if (!service.projectName && !service.projectId) {
				addFailure(failures, {
					code: 'missing_remote_resource_identifier',
					scope,
					provider: 'railway',
					message: `${scope} Railway service ${serviceKey} is missing a project name or id.`,
					details: { service: serviceKey, required: ['projectName', 'projectId'] },
				});
			}
			if (!service.serviceName && !service.serviceId) {
				addFailure(failures, {
					code: 'missing_remote_resource_identifier',
					scope,
					provider: 'railway',
					message: `${scope} Railway service ${serviceKey} is missing a service name or id.`,
					details: { service: serviceKey, required: ['serviceName', 'serviceId'] },
				});
			}
		}
	} catch (error) {
		addFailure(failures, {
			code: 'provider_resource_check_failed',
			scope,
			provider: 'deployment-state',
			message: `${scope} provider resource identifiers could not be validated.`,
			details: { error: error instanceof Error ? error.message : String(error) },
		});
	}
}

async function configParityChecks(root: string, failures: ReleaseCandidateFailure[]): Promise<ReleaseCandidateCheck> {
	if (getGitHubAutomationMode() === 'stub') {
		return { name: 'config-parity', status: 'skipped', detail: 'GitHub automation is stubbed.' };
	}
	const before = failures.length;
	localConfigCheck(root, 'staging', failures);
	localConfigCheck(root, 'prod', failures);
	await githubRemoteConfigCheck(root, 'staging', failures);
	await githubRemoteConfigCheck(root, 'prod', failures);
	providerResourceIdentifierCheck(root, 'staging', failures);
	providerResourceIdentifierCheck(root, 'prod', failures);
	return {
		name: 'config-parity',
		status: failures.length > before ? 'failed' : 'passed',
		detail: 'Checked staging and production config, GitHub names, Railway service identifiers, and D1 identifiers without reading secret values.',
	};
}

function migrationCompatibilityChecks(root: string, failures: ReleaseCandidateFailure[]): ReleaseCandidateCheck {
	if (!existsSync(resolve(root, 'migrations'))) {
		return {
			name: 'migration-compatibility',
			status: 'skipped',
			detail: 'No migrations directory is present in this workspace.',
		};
	}
	const requiredMigrations = [
		'migrations/0007_site_web_sessions.sql',
		'migrations/0014_better_auth_integer_timestamps.sql',
	];
	const missing = requiredMigrations.filter((path) => !existsSync(resolve(root, path)));
	for (const path of missing) {
		addFailure(failures, {
			code: 'missing_migration_fixture',
			scope: '@treeseed/market',
			message: `Migration compatibility check is missing ${path}.`,
			details: { path },
		});
	}
	return {
		name: 'migration-compatibility',
		status: missing.length > 0 ? 'failed' : 'passed',
		detail: 'Checked required legacy web session and Better Auth migration coverage.',
	};
}

export async function runReleaseCandidateGate(input: ReleaseCandidateInput): Promise<ReleaseCandidateReport> {
	const fingerprint = buildReleaseCandidateFingerprint(input);
	if (input.allowReuse !== false) {
		const cached = readCachedReleaseCandidateReport(input.root, fingerprint.key);
		if (cached?.status === 'passed') {
			return {
				...cached,
				reused: true,
			};
		}
	}
	const selectedPackageNames = [...new Set((input.selectedPackageNames ?? []).map(String))].sort();
	const plannedVersions = Object.fromEntries(
		Object.entries(input.plannedVersions).map(([name, version]) => [name, String(version)]),
	);
	const failures: ReleaseCandidateFailure[] = [];
	const checks: ReleaseCandidateCheck[] = [];
	checks.push(dependencyRehearsalChecks(input.root, plannedVersions, selectedPackageNames, failures));
	checks.push(packageReadinessChecks(input.root, selectedPackageNames, failures));
	checks.push(await configParityChecks(input.root, failures));
	checks.push(migrationCompatibilityChecks(input.root, failures));
	const report: ReleaseCandidateReport = {
		status: failures.length === 0 ? 'passed' : 'failed',
		fingerprint,
		reused: false,
		checkedAt: nowIso(),
		failures,
		checks,
	};
	writeReleaseCandidateReport(input.root, report);
	return report;
}
