import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { workspacePackages, workspaceRoot } from '../treedx/workspaces/workspace-tools.ts';
import { runRepositoryGit } from '../operations/git-runner.ts';
import { resolveLaunchEnvironment } from '../configuration/config-runtime.ts';
import { resolveGitHubCredentialForRepository } from '../configuration/github-credentials.ts';
import {
	createGitHubApiClient,
	getLatestGitHubWorkflowRun,
} from '../repositories/github-api.ts';
import { resolveDockerhubToken, resolveDockerhubUsername } from '../../../configuration/service-credentials.ts';
import { inspectContentStructure } from '../../../platform/content/content-runtime-source.ts';
import type {
	SeedContentPublishTargetKind,
	SeedContentRuntimeSource,
	SeedLocalContentMaterialization,
	SeedProjectArchitecture,
	SeedProjectResource,
	SeedProjectTopology,
} from '../../../seeds/types.ts';
import {
	SEED_CONTENT_PUBLISH_TARGETS,
	SEED_CONTENT_RUNTIME_SOURCES,
	SEED_LOCAL_CONTENT_MATERIALIZATIONS,
	SEED_PROJECT_TOPOLOGIES,
} from '../../../seeds/types.ts';
import { PackageAdapter, PackageWorkflowSyncResult, PackageWorkflowTemplateKind } from './package-kind.ts';
import { discoverPackageAdapters, findPackageAdapter } from './plan-package-development-image.ts';
import { workflowNameForTemplate } from './validate-package-manifests.ts';

export function renderPackageWorkflow(adapter: PackageAdapter, template: PackageWorkflowTemplateKind) {
	const verifyCommand = template === 'release-gate'
		? adapter.verifyCommands.release ?? adapter.verifyCommands.local
		: adapter.verifyCommands.local;
	const verify = verifyCommand
		? formatWorkflowRunCommand(verifyCommand.command, verifyCommand.args)
		: 'npm run verify:local';
	const setup = resolveWorkflowSetupCommand(adapter);
	const dockerArtifacts = adapter.artifacts.filter((artifact) => artifact.provider === 'docker');
	if (template === 'npm-publish') {
		return `name: Publish ${adapter.name}

on:
  push:
    tags:
      - "*.*.*"
  workflow_dispatch:

jobs:
  publish:
    if: startsWith(github.ref, 'refs/tags/') && !contains(github.ref_name, '-')
    runs-on: ubuntu-latest
    permissions:
      contents: write
    environment: production
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
      - run: ${setup}
      - run: ${verify}
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
      - name: Create GitHub release
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: gh release create "\${GITHUB_REF_NAME}" --generate-notes --verify-tag
`;
	}
	if (template === 'docker-image') {
		const environment = 'production';
		const imageSetup = adapter.kind === 'node-typescript' ? resolveDockerImageWorkflowSetupCommand() : null;
		const anyTarget = dockerArtifacts.some((artifact) => typeof artifact.target === 'string' && artifact.target.trim().length > 0);
		const dockerContextPrepareCommand = isRecord(adapter.metadata.scripts) && typeof adapter.metadata.scripts['capacity-provider:build'] === 'string'
			? 'npm run capacity-provider:build -- --prepare-only'
			: null;
		const trigger = `    tags:
      - "*.*.*"`;
		const jobCondition = "startsWith(github.ref, 'refs/tags/') && !contains(github.ref_name, '-')";
		const computeTagsStep = `      - name: Compute image tags
        id: tags
        run: |
          version="\${GITHUB_REF_NAME#v}"
          echo "base=\${version}" >> "$GITHUB_OUTPUT"
          echo "moving=" >> "$GITHUB_OUTPUT"
`;
		const releaseStep = `  release:
    needs: manifest
    if: ${jobCondition}
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - name: Create GitHub release
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: gh release create "\${GITHUB_REF_NAME}" --generate-notes --verify-tag
`;
		return `name: Publish Image ${adapter.name}

on:
  workflow_dispatch:
  push:
${trigger}

jobs:
  build:
    if: ${jobCondition}
    runs-on: \${{ matrix.runner }}
    permissions:
      contents: write
      packages: write
    environment: ${environment}
    strategy:
      matrix:
        include:
${dockerArtifacts.flatMap((artifact) => [
	`          - image: ${artifact.name}${anyTarget ? `\n            target: ${artifact.target ?? ''}` : ''}
            arch: amd64
            platform: linux/amd64
            runner: ubuntu-24.04`,
	`          - image: ${artifact.name}${anyTarget ? `\n            target: ${artifact.target ?? ''}` : ''}
            arch: arm64
            platform: linux/arm64
            runner: ubuntu-24.04-arm`,
]).join('\n') || `          - image: treeseed/unknown
            arch: amd64
            platform: linux/amd64
            runner: ubuntu-24.04`}
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
${imageSetup ? `      - run: ${imageSetup}\n` : ''}${dockerContextPrepareCommand ? `      - run: ${dockerContextPrepareCommand}\n` : ''}${computeTagsStep}      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          username: \${{ vars.TREESEED_DOCKERHUB_USERNAME }}
          password: \${{ secrets.TREESEED_DOCKERHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
${anyTarget ? '          target: ${{ matrix.target }}\n' : ''}          platforms: \${{ matrix.platform }}
          push: true
          tags: \${{ matrix.image }}:\${{ steps.tags.outputs.base }}-\${{ matrix.arch }}

  manifest:
    needs: build
    if: ${jobCondition}
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      packages: write
    environment: ${environment}
    strategy:
      matrix:
        include:
${dockerArtifacts.map((artifact) => `          - image: ${artifact.name}`).join('\n') || '          - image: treeseed/unknown'}
    steps:
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          username: \${{ vars.TREESEED_DOCKERHUB_USERNAME }}
          password: \${{ secrets.TREESEED_DOCKERHUB_TOKEN }}
${computeTagsStep}      - name: Publish multi-architecture manifest
        run: |
          docker buildx imagetools create \\
            -t "\${{ matrix.image }}:\${{ steps.tags.outputs.base }}" \\
            "\${{ matrix.image }}:\${{ steps.tags.outputs.base }}-amd64" \\
            "\${{ matrix.image }}:\${{ steps.tags.outputs.base }}-arm64"
${releaseStep}`;
	}
	const needsNodeSetup = adapter.kind === 'node-typescript';
	const needsBeamSetup = adapter.kind === 'beam-elixir-rust';
	return `name: Verify ${adapter.name}

on:
  push:
  pull_request:
  workflow_dispatch:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
${needsNodeSetup ? `      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: ${setup}
` : ''}${needsBeamSetup ? `      - uses: erlef/setup-beam@v1
        with:
          otp-version: "27"
          elixir-version: "1.17.3"
      - run: mix local.hex --force && mix local.rebar --force
` : ''}      - run: ${verify}
`;
}

export function resolveWorkflowSetupCommand(adapter: PackageAdapter) {
	const scripts = adapter.metadata.scripts;
	if (isRecord(scripts) && typeof scripts['release:setup'] === 'string') {
		return 'npm run release:setup';
	}
	return 'npm ci';
}

export function resolveDockerImageWorkflowSetupCommand() {
	return 'npm ci --ignore-scripts';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function formatWorkflowRunCommand(command: string, args: string[]) {
	return [command, ...args].map(shellQuoteWorkflowArg).join(' ');
}

export function shellQuoteWorkflowArg(value: string) {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
	return `'${value.replace(/'/gu, `'\\''`)}'`;
}

export function workflowTemplatesForAdapter(adapter: PackageAdapter): PackageWorkflowTemplateKind[] {
	if (adapter.metadata.workflowTemplateVersion === 'custom') {
		return [];
	}
	const hasDocker = adapter.artifacts.some((artifact) => artifact.provider === 'docker');
	const hasNpm = adapter.artifacts.some((artifact) => artifact.provider === 'npm');
	return [
		...(hasNpm ? ['npm-publish' as const] : []),
		...(hasDocker ? ['docker-image' as const] : []),
		'release-gate' as const,
	];
}

export function syncPackageWorkflows({
	root = workspaceRoot(),
	packageId,
	execute = false,
}: {
	root?: string;
	packageId?: string | null;
	execute?: boolean;
} = {}): PackageWorkflowSyncResult[] {
	const adapters = packageId && packageId !== 'all'
		? [findPackageAdapter(root, packageId)].filter((entry): entry is PackageAdapter => Boolean(entry))
		: discoverPackageAdapters(root);
	const results: PackageWorkflowSyncResult[] = [];
	for (const adapter of adapters) {
		for (const template of workflowTemplatesForAdapter(adapter)) {
			const workflow = workflowNameForTemplate(adapter, template);
			const path = resolve(adapter.dir, '.github', 'workflows', workflow);
			const rendered = renderPackageWorkflow(adapter, template);
			const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
			const changed = current !== rendered;
			if (execute && changed) {
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(path, rendered, 'utf8');
			}
			results.push({
				packageId: adapter.id,
				path,
				workflow,
				template,
				exists: current != null,
				changed,
				written: execute && changed,
			});
		}
	}
	return results;
}
