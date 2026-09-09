import { describe, expect, it } from 'vitest';
import { postgresTopologySchema } from '../../../src/deployment/postgres/contracts.ts';

function fixture() {
  return {
    schemaVersion: 'treeseed.postgres-topology/v1', installationId: 'test', environment: 'staging',
    servers: [{ id: 'shared', installationId: 'test', environment: 'staging', mode: 'shared', hostname: 'postgres', port: 5432, major: 17, extensions: [], tls: { mode: 'verify-full', trustReference: 'postgres-ca' } }],
    requirements: ['api', 'identity'].map(id => ({ id, componentId: id, enabled: true, supportedMajors: [17], extensions: [], runtimeConnectionLimit: 10 })),
    allocations: ['api', 'identity'].map(id => ({ requirementId: id, serverId: 'shared', database: id, ownerRole: `${id}_owner`, migrationRole: `${id}_migrator`, runtimeRole: `${id}_runtime`, migrationCredentialReference: `${id}-migration`, runtimeCredentialReference: `${id}-runtime`, onDisable: 'preserve' })),
  };
}
describe('shared PostgreSQL contracts', () => {
  it('accepts isolated application databases on one server', () => expect(postgresTopologySchema.parse(fixture()).allocations).toHaveLength(2));
  it('allows disabled unallocated requirements without deleting retained allocations', () => {
    const value = fixture(); value.requirements[1]!.enabled = false;
    expect(postgresTopologySchema.safeParse(value).success).toBe(true);
    value.allocations.pop(); expect(postgresTopologySchema.safeParse(value).success).toBe(true);
  });
  it.each(['database', 'role', 'environment', 'major', 'missing', 'superuser', 'secret', 'tls', 'duplicate-server'])('rejects %s conflicts', mode => {
    const value = fixture();
    if (mode === 'database') value.allocations[1]!.database = 'api';
    if (mode === 'role') value.allocations[1]!.runtimeRole = 'api_runtime';
    if (mode === 'environment') value.servers[0]!.environment = 'production';
    if (mode === 'major') value.servers[0]!.major = 16;
    if (mode === 'missing') value.allocations.pop();
    if (mode === 'superuser') value.allocations[0]!.runtimeRole = 'postgres';
    if (mode === 'secret') Object.assign(value.servers[0]!, { password: 'not-allowed' });
    if (mode === 'tls') value.servers[0]!.tls.mode = 'disable';
    if (mode === 'duplicate-server') value.servers.push({ ...value.servers[0]!, id: 'another' });
    expect(postgresTopologySchema.safeParse(value).success).toBe(false);
  });
});
