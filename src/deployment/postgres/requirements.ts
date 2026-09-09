import { componentReleaseSchema, hostConfigurationSchema } from '../schemas.ts';
import { canonicalDeploymentJson, deploymentDigest } from '../canonical.ts';
import type { PostgresRequirement } from './contracts.ts';

/** Call after artifact authenticity verification, with the complete selected
 * component inventory. Host configuration cannot weaken a package requirement.
 */
export function verifyHostPostgresRequirements(hostInput: unknown, releaseInputs: unknown[]) {
  const host = hostConfigurationSchema.parse(hostInput);
  const releases = releaseInputs.map(input => componentReleaseSchema.parse(input));
  if (new Set(releases.map(item => item.componentId)).size !== releases.length) throw new Error('Duplicate component release inventory');
  if (Object.entries(host.components).some(([id, selection]) => selection.enabled && !releases.some(release => release.componentId === id))) throw new Error('Selected component release inventory is incomplete');
  const requirements: PostgresRequirement[] = [];
  for (const release of releases) {
    const selection = host.components[release.componentId];
    if (!selection) continue;
    if (deploymentDigest(release.runtime) !== release.runtimeDigest) throw new Error('Component runtime digest mismatch');
    for (const requirement of release.runtime.postgresRequirements ?? []) requirements.push({ ...requirement,
      componentId: release.componentId, enabled: selection.enabled });
  }
  if (new Set(requirements.map(item => item.id)).size !== requirements.length) throw new Error('Component database requirement identities collide');
  const normalize = (items: PostgresRequirement[]) => items.map(item => ({ ...item,
    supportedMajors: [...item.supportedMajors].sort((a, b) => a - b), extensions: [...item.extensions].sort() })).sort((a, b) => a.id.localeCompare(b.id));
  if (canonicalDeploymentJson(normalize(requirements)) !== canonicalDeploymentJson(normalize(host.postgres?.requirements ?? []))) throw new Error('Host database requirements differ from selected immutable components');
  return { verified: true as const, requirements };
}
