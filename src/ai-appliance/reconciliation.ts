import type { DeployConfig } from '../platform/support/contracts.ts';
import type { DesiredUnit } from '../reconcile/support/contracts/contracts.ts';
import { reconcileTarget } from '../reconcile/engine/reconcile-target.ts';
import type { AiApplianceManifest } from './contracts.ts';
import { validateAiApplianceManifest } from './validation.ts';

const localTarget = { kind: 'persistent', scope: 'local' } as const;

function localDeployConfig(tenantRoot: string): DeployConfig {
	return { name: 'AI appliance', slug: 'ai-appliance', siteUrl: 'http://127.0.0.1', contactEmail: 'local@localhost', __tenantRoot: tenantRoot } as DeployConfig;
}

export function compileAiApplianceUnits(tenantRoot: string, manifest: AiApplianceManifest, composeFile = 'compose.ai.yml'): DesiredUnit[] {
	const validation = validateAiApplianceManifest(manifest);
	if (!validation.ok) throw new Error(`AI appliance manifest is invalid: ${validation.diagnostics.map((entry) => `${entry.path}: ${entry.message}`).join('; ')}`);
	const identity = { teamId: 'local', projectId: 'ai-appliance', slug: 'ai-appliance', environment: 'local', deploymentKey: 'ai-appliance-local', environmentKey: 'local' };
	return [{
		unitId: 'local-docker-compose:ai-inference', unitType: 'local-docker-compose', provider: 'local', identity, target: localTarget,
		logicalName: 'AI inference appliance', dependencies: [],
		spec: {
			composeFile, composeFiles: [composeFile], projectName: 'treeseed-ai-inference', cwd: '.', dataDir: '.treeseed/ai', buildPolicy: 'never',
			env: {
				TREESEED_AI_MODEL: manifest.inference.model,
				TREESEED_AI_MODEL_ALIAS: manifest.inference.publicAlias,
				TREESEED_AI_MAX_MODEL_LENGTH: String(manifest.inference.maxModelLength),
				TREESEED_AI_MAX_CONCURRENT_SEQUENCES: String(manifest.inference.maxConcurrentSequences),
				TREESEED_AI_GPU_MEMORY_UTILIZATION: String(manifest.inference.gpuMemoryUtilization),
			},
			services: ['vllm'], healthChecks: [{ id: 'vllm-health', kind: 'http', url: new URL('/health', manifest.inference.rawVllmUrl).toString() }],
		},
		secrets: {}, metadata: { packageId: '@treeseed/ai', serviceId: 'inference' },
	}];
}

export async function reconcileAiAppliance(input: { tenantRoot: string; manifest: AiApplianceManifest; plan: boolean; composeFile?: string; env?: NodeJS.ProcessEnv; write?: (line: string) => void }) {
	const units = compileAiApplianceUnits(input.tenantRoot, input.manifest, input.composeFile);
	return reconcileTarget({ tenantRoot: input.tenantRoot, target: localTarget, units, planOnly: input.plan, env: input.env, write: input.write, deployConfig: localDeployConfig(input.tenantRoot) });
}
