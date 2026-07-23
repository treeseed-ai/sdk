import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { collectTreeseedReconcileStatus, reconcileTreeseedTarget } from '../../../reconcile/index.ts';
import { checkTreeseedProviderConnections, collectTreeseedConfigSeedValues, syncTreeseedGitHubEnvironment } from '../config-runtime.ts';
import { createPersistentDeployTarget, runRemoteD1Migrations, finalizeDeploymentState } from '../deploy.ts';
import {
	createGitHubRepository,
	ensureGitHubDeployAutomation,
	initializeGitHubRepositoryWorkingTree,
	resolveGitHubRemoteUrls,
	resolveDefaultGitHubOwner,
} from '../github-automation.ts';
import { configuredRailwayServices, deployRailwayService, ensureRailwayScheduledJobs, validateRailwayDeployPrerequisites, verifyRailwayScheduledJobs } from '../railway-deploy.ts';
import { loadCliDeployConfig } from '../runtime-tools.ts';
import { templateCatalogRoot } from '../runtime-paths.ts';
import { scaffoldTemplateProject } from '../template-registry.ts';
import { applyProjectLaunchHostBindingConfig } from '../template-host-bindings.ts';
import { runTreeseedGit } from '../git-runner.ts';
import {
	ProjectLaunchSecretSyncError,
	syncProjectLaunchHostBindingSecrets,
	type ProjectLaunchSecretSyncResult,
} from '../template-secret-sync.ts';
import { buildKnowledgePackMarketPackage, buildTemplateMarketPackage, importKnowledgePack } from '../market-packaging.ts';
import { resolveTreeseedToolBinary } from '../../../managed-dependencies.ts';
import { TREESEED_DEFAULT_STARTER_TEMPLATE_ID } from '../../../sdk-types.ts';
import type {
	ProjectLaunchConfigWritePlanItem,
	ProjectLaunchResolvedHostBinding,
	ProjectLaunchSecretDeploymentPlanItem,
} from '../../../template-launch-requirements.ts';
import { KnowledgeHubProviderLaunchInput, slugify, writeText } from './knowledge-hub-provider-launch-failure-phase.ts';

export function currentTemplateCatalogUrl() {
	return `file:${resolve(templateCatalogRoot, 'catalog.fixture.json')}`;
}

export function frontmatter(fields: Record<string, unknown>) {
	return `---\n${stringifyYaml(fields).trim()}\n---`;
}

export function normalizeMarkdownBody(value: string | null | undefined, fallback: string) {
	const markdown = String(value ?? '').trim();
	return markdown || fallback;
}

export function markdownToSummary(markdown: string, fallback: string) {
	const text = markdown
		.replace(/^---[\s\S]*?---/u, ' ')
		.replace(/```[\s\S]*?```/gu, ' ')
		.replace(/`([^`]+)`/gu, '$1')
		.replace(/!\[[^\]]*\]\([^)]+\)/gu, ' ')
		.replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
		.replace(/^#{1,6}\s+/gmu, '')
		.replace(/^\s*[-*+]\s+/gmu, '')
		.replace(/^\s*\d+\.\s+/gmu, '')
		.replace(/[*_~>#]/gu, '')
		.replace(/\s+/gu, ' ')
		.trim();
	if (!text) return fallback;
	return text.length > 240 ? `${text.slice(0, 237).trimEnd()}...` : text;
}

export function seedLaunchContent(projectRoot: string, input: KnowledgeHubProviderLaunchInput) {
	const objectiveId = `objective:launch-${slugify(input.projectSlug, 'hub')}`;
	const questionId = `question:operating-${slugify(input.projectSlug, 'hub')}`;
	const proposalId = `proposal:operating-${slugify(input.projectSlug, 'hub')}`;
	const decisionId = `decision:launch-${slugify(input.projectSlug, 'hub')}`;
	const stewardSlug = 'launch-steward';
	const noteSlug = `${slugify(input.projectSlug, 'hub')}-operating-model`;
	const today = new Date().toISOString().slice(0, 10);
	const defaultCoreObjective = `# Core Objective

Build and maintain ${input.projectName} as a living TreeSeed project with clear direction, active work, reliable releases, and useful AI agent context.
`;
	const coreObjective = normalizeMarkdownBody(input.coreObjective ?? input.summary, defaultCoreObjective);
	const coreObjectiveSummary = markdownToSummary(coreObjective, `Define the enduring objective for ${input.projectName}.`);
	writeText(resolve(projectRoot, 'src/content/people', `${stewardSlug}.mdx`), `---
name: Launch Steward
role: Team steward
affiliation: ${input.projectName}
status: live
tags:
  - launch
  - stewardship
---

The launch steward keeps the first operating cycle legible while the hub moves from setup into active use.
`);
	writeText(resolve(projectRoot, 'src/content/objectives', 'core.md'), `${frontmatter({
	id: 'objective:core',
	title: `${input.projectName} Core Objective`,
	description: coreObjectiveSummary,
	date: today,
	summary: coreObjectiveSummary,
	status: 'live',
	timeHorizon: 'strategic',
	motivation: 'The core objective anchors TreeSeed agent context and keeps project work aligned.',
	primaryContributor: stewardSlug,
	canonical: true,
})}

${coreObjective}
`);
	writeText(resolve(projectRoot, 'src/content/objectives', 'launch-knowledge-hub.mdx'), `---
id: ${objectiveId}
title: Launch ${input.projectName}
description: Bring the initial knowledge hub online with live managed infrastructure and a clear operating direction.
date: ${today}
summary: Stand up the hub, connect the runtime, and make the first workstream visible to the team.
status: live
timeHorizon: near-term
motivation: TreeSeed launches should create immediately usable hubs instead of leaving teams in setup limbo.
primaryContributor: ${stewardSlug}
relatedObjectives:
  - core
---

Launch ${input.projectName} as a living knowledge hub with real GitHub, Cloudflare, and Railway infrastructure.
`);
	writeText(resolve(projectRoot, 'src/content/questions', 'what-should-the-first-release-cover.mdx'), `---
id: ${questionId}
title: What Should The First Release Cover?
description: Scope the first release around the foundation of the hub and the initial operating routines.
date: ${today}
summary: Define the first release around setup completion, clear direction, and baseline operating visibility.
status: live
questionType: strategy
motivation: The first release should make the new hub usable without burying the team under setup debt.
primaryContributor: ${stewardSlug}
relatedObjectives:
  - launch-knowledge-hub
---

The first release should verify that the hub is live, the core direction is visible, and the team can move from Direct into Workstreams without setup debt.
`);
	writeText(resolve(projectRoot, 'src/content/notes', `${noteSlug}.mdx`), `---
title: ${input.projectName} Operating Model
description: The initial working agreements for this Knowledge Hub.
date: ${today}
summary: Managed launch created the default branches, runtime wiring, and first operational checkpoints.
status: live
---

This hub starts with a Knowledge Hub launch, a seeded objective, and a visible first workstream so the team can continue from a known baseline.
`);
	writeText(resolve(projectRoot, 'src/content/proposals', 'establish-initial-operating-routine.mdx'), `---
id: ${proposalId}
title: Establish The Initial Operating Routine
description: Turn the seeded objective and question into a concrete launch proposal for the first team cycle.
date: ${today}
summary: Make the launch posture explicit so the team can move from setup into a concrete operating loop.
status: live
proposalType: strategy
motivation: Managed launches work better when the first suggested operating pattern is visible in the content model.
primaryContributor: ${stewardSlug}
relatedObjectives:
  - launch-knowledge-hub
relatedQuestions:
  - what-should-the-first-release-cover
relatedNotes:
  - ${noteSlug}
decision: adopt-initial-launch-posture
---

Adopt a simple first operating routine: keep direction visible, keep the first release narrow, and use notes to capture implementation reality as the hub stabilizes.
`);
	writeText(resolve(projectRoot, 'src/content/decisions', 'adopt-initial-launch-posture.mdx'), `---
id: ${decisionId}
title: Adopt The Initial Launch Posture
description: Record the launch decision for the first operating cycle of the hub.
date: ${today}
summary: The Knowledge Hub launch will begin with a narrow first release and explicit direction artifacts.
status: live
decisionType: approved
rationale: The initial launch should bias toward clarity, setup completion, and a visible first release loop.
authority: Knowledge Hub launch
primaryContributor: ${stewardSlug}
relatedObjectives:
  - launch-knowledge-hub
relatedQuestions:
  - what-should-the-first-release-cover
relatedNotes:
  - ${noteSlug}
relatedProposals:
  - establish-initial-operating-routine
implements:
  - direct
  - workstreams
---

The first cycle will keep direction and execution tightly connected: one seeded objective, one seeded question, one proposal, one recorded launch decision, and a narrow release target.
`);
	writeText(resolve(projectRoot, 'src/content/knowledge', 'handbook', 'index.mdx'), `---
id: knowledge:${slugify(input.projectSlug, 'hub')}-handbook
title: ${input.projectName} Handbook
description: Welcome guide for the first team working in this hub.
type: guide
status: canonical
tags:
  - handbook
  - launch
canonical: true
domain: product
audience:
  - maintainer
  - contributor
---

# ${input.projectName}

This knowledge hub was launched from TreeSeed and is ready for Direct, Workstreams, Releases, and Share workflows.
`);
	writeText(resolve(projectRoot, 'src/content/pages', 'welcome.mdx'), `---
title: Welcome
description: ${input.projectName} is live.
pageLayout: article
stage: live
---

# ${input.projectName}

This hub is live and ready for the first team release cycle.
`);
	return {
		objectiveId,
		questionId,
		proposalId,
		decisionId,
		noteSlug,
	};
}

export function ensureHostedProjectFiles(projectRoot: string) {
	const sdkApiPackage = ['@treeseed', 'sdk/api'].join('/');
	writeText(resolve(projectRoot, 'src/api/server.ts'), `import { createRailwayTreeseedApiServer } from '${sdkApiPackage}';

const server = await createRailwayTreeseedApiServer();
console.log(\`Treeseed project API listening on \${server.url}\`);
`);
}
