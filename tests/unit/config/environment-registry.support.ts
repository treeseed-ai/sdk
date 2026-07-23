import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getTreeseedEnvironmentSuggestedValues,
	isTreeseedEnvironmentEntryRequired,
	isTreeseedEnvironmentEntryRelevant,
	resolveTreeseedEnvironmentRegistry,
} from '../../../src/platform/environment.ts';
export const tempRoots = new Set<string>();
export const agentProcessingRegistryFixtureYaml = `entries:
  TREESEED_PROJECT_RUNNER_TOKEN:
    label: Project runner registration token
    group: hosting
    description: Project runner token.
    howToGet: Set the project runner token.
    sensitivity: secret
    targets:
      - github-secret
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: conditional
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
    sourcePriority:
      - machine-config
      - process-env
    relevanceRef: projectRegistrationEnabled
`;
export const codexRegistryFixtureYaml = `entries:
  TREESEED_CODEX_AUTH_JSON_B64:
    label: Codex auth JSON bootstrap secret
    group: auth
    description: Base64-encoded Codex login auth.json.
    howToGet: Store a base64-encoded Codex auth.json.
    sensitivity: secret
    targets:
      - railway-secret
      - github-secret
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - bootstrap
      - config
    validation:
      kind: nonempty
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_AUTH_OVERWRITE:
    label: Overwrite Codex auth file
    group: auth
    description: Codex auth overwrite flag.
    howToGet: Set only during auth rotation.
    sensitivity: plain
    targets:
      - railway-var
      - local-runtime
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - bootstrap
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_SUBSCRIPTION_PLAN:
    label: Codex subscription plan
    group: auth
    description: Codex subscription plan.
    howToGet: Set the subscription plan.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: enum
      values:
        - plus
        - pro
        - business
        - edu
        - enterprise
        - unknown
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_DEFAULT_MODEL:
    label: Codex default model
    group: auth
    description: Codex default model.
    howToGet: Set the default model.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: nonempty
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_APPROVAL_POLICY:
    label: Codex approval policy
    group: auth
    description: Codex approval policy.
    howToGet: Set the approval policy.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: enum
      values:
        - never
        - on_request
        - always
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_SANDBOX_MODE:
    label: Codex sandbox mode
    group: auth
    description: Codex sandbox mode.
    howToGet: Set the sandbox mode.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: enum
      values:
        - read_only
        - workspace_write
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_TIMEOUT_MS:
    label: Codex execution timeout
    group: auth
    description: Codex execution timeout.
    howToGet: Set the timeout in milliseconds.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: number
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_REQUIRE_RELEASE_DECISION:
    label: Require Codex release decision
    group: auth
    description: Require release decision.
    howToGet: Set true or false.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_ALLOW_FEATURE_BRANCH_MUTATION:
    label: Allow feature branch mutation
    group: auth
    description: Allow feature branch mutation.
    howToGet: Set true or false.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_ALLOW_AUTOMATIC_STAGING_MERGE:
    label: Allow automatic staging merge
    group: auth
    description: Allow automatic staging merge.
    howToGet: Set true or false.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_REQUIRE_ALLOWED_PATHS:
    label: Require allowed paths
    group: auth
    description: Require allowed paths.
    howToGet: Set true or false.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_RECORD_THREAD_IDS:
    label: Record Codex thread IDs
    group: auth
    description: Record Codex thread IDs.
    howToGet: Set true or false.
    sensitivity: plain
    targets:
      - github-variable
      - railway-var
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
`;
export const coreFormsRegistryFixtureYaml = `entries:
  TREESEED_FORM_TOKEN_SECRET:
    label: Forms token secret
    group: forms
    description: Forms token secret.
    howToGet: Generate a shared forms token secret.
    sensitivity: secret
    targets:
      - github-secret
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: required
    purposes:
      - dev
      - save
      - deploy
      - config
    validation:
      kind: nonempty
    sourcePriority:
      - machine-config
      - process-env
    defaultValueRef: generatedSecret
    localDefaultValueRef: generatedSecret
    relevanceRef: formsEnabled
  TREESEED_TURNSTILE_SECRET_KEY:
    label: Turnstile secret key
    group: forms
    description: Turnstile secret key.
    howToGet: Treeseed creates and syncs this from the managed Cloudflare Turnstile widget during deploy.
    sensitivity: secret
    visibility: system
    targets:
      - github-secret
    scopes:
      - staging
      - prod
    storage: shared
    requirement: generated
    purposes:
      - deploy
    validation:
      kind: nonempty
    sourcePriority:
      - generated
    relevanceRef: turnstileEnabled
  TREESEED_SMTP_HOST:
    label: SMTP host
    group: smtp
    description: SMTP host.
    howToGet: Set the SMTP host.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: conditional
    purposes:
      - dev
      - save
      - deploy
      - config
    validation:
      kind: nonempty
    sourcePriority:
      - machine-config
      - process-env
    localDefaultValueRef: localSmtpHostDefault
    relevanceRef: smtpEnabled
    requiredWhenRef: smtpNonLocal
  TREESEED_SMTP_PORT:
    label: SMTP port
    group: smtp
    description: SMTP port.
    howToGet: Set the SMTP port.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: conditional
    purposes:
      - dev
      - save
      - deploy
      - config
    validation:
      kind: number
    sourcePriority:
      - machine-config
      - process-env
    localDefaultValueRef: localSmtpPortDefault
    relevanceRef: smtpEnabled
    requiredWhenRef: smtpNonLocal
  TREESEED_SMTP_FROM:
    label: SMTP from address
    group: smtp
    description: SMTP from address.
    howToGet: Set a verified sender address.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: conditional
    purposes:
      - dev
      - save
      - deploy
      - config
    validation:
      kind: email
    sourcePriority:
      - machine-config
      - process-env
    localDefaultValueRef: contactEmailDefault
    relevanceRef: smtpEnabled
    requiredWhenRef: smtpNonLocal
  TREESEED_SMTP_REPLY_TO:
    label: SMTP reply-to address
    group: smtp
    description: SMTP reply-to address.
    howToGet: Set a reply-to address.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: conditional
    purposes:
      - dev
      - save
      - deploy
      - config
    validation:
      kind: email
    sourcePriority:
      - machine-config
      - process-env
    localDefaultValueRef: contactEmailDefault
    relevanceRef: smtpEnabled
    requiredWhenRef: smtpNonLocal
`;
export async function createTenantFixture(envYaml: string) {
	const tenantRoot = await mkdtemp(join(tmpdir(), 'treeseed-sdk-env-registry-'));
	await mkdir(join(tenantRoot, 'src'), { recursive: true });
	await writeFile(
		join(tenantRoot, 'src/manifest.yaml'),
		'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n',
	);
	await writeFile(
		join(tenantRoot, 'treeseed.site.yaml'),
		'name: Test Site\nslug: test-site\nsiteUrl: https://example.com\ncontactEmail: hello@example.com\ncloudflare:\n  accountId: account-123\nservices:\n  api:\n    provider: railway\n    enabled: true\n',
	);
	await writeFile(join(tenantRoot, 'src/env.yaml'), envYaml);
	return tenantRoot;
}
export function findRegistryEntry(registry: ReturnType<typeof resolveTreeseedEnvironmentRegistry>, id: string) {
	return registry.entries.find((entry) => entry.id === id);
}

