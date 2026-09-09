import { describe, expect, it } from 'vitest';
import { protectedResourceMetadataSchema } from '../../../src/identity/contracts.ts';

const metadata = { resource: 'https://api.example.test/mcp', authorization_servers: ['https://identity.example.test/realms/local'],
  scopes_supported: ['treeseed:read', 'custom:read'], bearer_methods_supported: ['header'] };
describe('protected resource identity discovery', () => {
  it('supports explicit independent issuers and custom resource scopes without inferring trust', () => {
    expect(protectedResourceMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(protectedResourceMetadataSchema.parse({ ...metadata, arbitrary_credentials_url: 'https://attacker.test' })).not.toHaveProperty('arbitrary_credentials_url');
  });
  it('accepts optional discovery fields without inventing a scope grant', () => {
    expect(protectedResourceMetadataSchema.parse({ resource: metadata.resource, authorization_servers: metadata.authorization_servers }).scopes_supported).toBeUndefined();
  });
  it('rejects unsafe resource and authorization server addresses', () => {
    for (const resource of ['http://api.test', 'https://user:password@api.test', 'https://api.test/#fragment', 'https://api.test/?token=value'])
      expect(() => protectedResourceMetadataSchema.parse({ ...metadata, resource })).toThrow();
    for (const authorization_servers of [[], ['http://identity.test'], [...metadata.authorization_servers, ...metadata.authorization_servers]])
      expect(() => protectedResourceMetadataSchema.parse({ ...metadata, authorization_servers })).toThrow();
  });
  it('rejects query/body bearer transport and ambiguous scope inventories', () => {
    for (const bearer_methods_supported of [['query'], ['header', 'query'], ['header', 'header']])
      expect(() => protectedResourceMetadataSchema.parse({ ...metadata, bearer_methods_supported })).toThrow();
    for (const scopes_supported of [['duplicate', 'duplicate'], ['invalid scope'], ['x'.repeat(129)]])
      expect(() => protectedResourceMetadataSchema.parse({ ...metadata, scopes_supported })).toThrow();
  });
});
