import { z } from 'zod';
import { defineOperation } from '../../operation-builder.ts';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const path = z.object({ teamId: id, connectionId: id, profileId: id }).strict();
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const descriptor = z.object({
  teamId: id, connectionId: id, profileId: id, custody: z.literal('openbao'),
  version, configured: z.boolean(), fields: z.array(id),
}).strict();
const put = z.object({ expectedVersion: version,
  values: z.record(z.string().max(1024 * 1024)).refine(v => Object.keys(v).length > 0 && Object.keys(v).length <= 128),
}).strict();
function operation(name: 'show' | 'put' | 'delete' | 'validate', method: 'GET' | 'PUT' | 'DELETE' | 'POST') {
  const read = method === 'GET';
  return defineOperation({
    operationId: `services.credentials.${name}`, description: `${name} managed service credentials.`,
    rest: { method, path: `/v1/teams/{teamId}/services/{connectionId}/credentials/{profileId}${name === 'validate' ? '/validate' : ''}` },
    parameters: `treeseed.services.credentials.${name}.parameters/v1`,
    capability: read ? 'secrets.read' : 'secrets.write', authentication: 'oauth',
    oauthScopes: read ? ['treeseed:read'] : ['treeseed:projects:write'],
    kind: read ? 'read' : 'mutation', riskClass: read ? 'ordinary' : 'credential',
    confirmation: 'never', surfaces: ['rest'], cacheScope: 'none', pagination: 'none',
    redactedPaths: ['body.values'],
  }, { path, query: z.object({}).strict(), body: read ? z.undefined() : name === 'put' ? put
    : z.object({ expectedVersion: version }).strict(),
    output: name === 'validate' ? z.object({ ok: z.boolean() }).strict() : descriptor });
}
export const SECRET_OPERATIONS = {
  credentialStatus: operation('show', 'GET'),
  putCredentials: operation('put', 'PUT'),
  deleteCredentials: operation('delete', 'DELETE'),
  validateCredentials: operation('validate', 'POST'),
} as const;
