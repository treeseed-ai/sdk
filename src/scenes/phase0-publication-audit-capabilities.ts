import type { TreeseedSceneCapability } from './types.ts';

export const PHASE0_PUBLICATION_AUDIT_CAPABILITIES = [
{
				id: 'scene.docs-publication-plan',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Documentation publication destinations and selected artifacts are planned without mutating docs stores.',
			},
{
				id: 'scene.training-publication-plan',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Training publication destinations and selected captions, transcripts, narration, glossary, and clip manifests are planned locally.',
			},
{
				id: 'scene.release-evidence-publication-plan',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Release-evidence publication plans are generated from redacted publish manifests and block failed workflows.',
			},
{
				id: 'scene.artifact-store-publication-plan',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Artifact-store publication is represented as plan-only metadata without remote upload.',
			},
{
				id: 'scene.reconciliation-publication-intents',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Phase 11 manifests include plan-only reconciliation intent records for future canonical apply workflows.',
			},
{
				id: 'scene.local-publication-export',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Selected redacted publish artifacts can be copied into local docs, training, and release-evidence export folders.',
			},
{
				id: 'scene.visual-audit-command',
				status: 'available',
				owner: '@treeseed/cli',
				summary: 'The CLI can generate role and device screenshot review matrices with `trsd scene visual-audit`.',
			},
{
				id: 'scene.visual-audit-route-discovery',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Visual audits discover user-facing core, admin, tenant override, and content-backed routes.',
			},
{
				id: 'scene.visual-audit-role-fixtures',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Visual audits model anonymous and deterministic local fixture-backed owner, admin, and member roles.',
			},
{
				id: 'scene.visual-audit-device-matrix',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Visual audits reuse scene device profiles to capture desktop, tablet, and mobile screenshots.',
			},
{
					id: 'scene.visual-audit-screenshot-report',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audits write grouped viewport screenshots plus JSON and Markdown review reports.',
				},
{
					id: 'scene.visual-audit-review',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audits generate deterministic functional, client-error, display, and architecture findings by default.',
				},
{
					id: 'scene.visual-audit-client-error-capture',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audit captures browser console, page, request, and HTTP errors for each reviewed route.',
				},
{
					id: 'scene.visual-audit-functional-findings',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audit review flags failed captures, auth redirects, protected anonymous access, and seeded fixture visibility issues.',
				},
{
					id: 'scene.visual-audit-display-findings',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audit review flags default-looking controls, horizontal overflow, visible error text, and low-content captures.',
				},
{
					id: 'scene.visual-audit-agent-brief',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audit review writes an agent-focused repair brief that prioritizes reusable package architecture.',
				},
{
					id: 'scene.visual-audit-contact-sheets',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audit review writes local HTML contact sheets grouped by path root and flagged screenshots.',
				},
{
				id: 'scene.remote-publication-apply',
				status: 'planned',
				owner: '@treeseed/sdk',
				summary: 'Applying Phase 11 publication intents to external providers is deferred to Phase 12.',
			},
{
				id: 'scene.remote-artifact-store-apply',
				status: 'planned',
				owner: '@treeseed/sdk',
				summary: 'Remote artifact-store upload remains deferred until provider selection and retention policy are finalized.',
			},
{
				id: 'scene.docs-training-publishing',
				status: 'planned',
				owner: '@treeseed/sdk',
				summary: 'Docs and training-site external publication remains deferred to reconciled remote apply workflows.',
			},
{
				id: 'scene.tts-audio-generation',
				status: 'planned',
				owner: '@treeseed/sdk',
				summary: 'Optional text-to-speech audio generation is planned after deterministic training outputs.',
			}
] satisfies TreeseedSceneCapability[];
