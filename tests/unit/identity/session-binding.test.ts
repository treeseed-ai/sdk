import { expect, it } from 'vitest';
import { publicClientSessionBindingSchema } from '../../../src/identity/contracts.ts';

const binding = { identity: { issuer:'https://identity.example.test/realms/local', subject:'opaque-subject' }, clientId:'trsd', scopes:['treeseed:read'] };
it('requires an explicit issuer-qualified native session identity and client', () => {
  expect(publicClientSessionBindingSchema.parse(binding)).toEqual(binding);
  for (const input of [
    {...binding, identity:undefined}, {...binding, identity:{email:'someone@example.test'}},
    {...binding, identity:{...binding.identity, issuer:'http://identity.test'}},
    {...binding, clientId:''}, {...binding, scopes:['duplicate','duplicate']},
    {...binding, token:'not-a-public-binding-field'},
  ]) expect(() => publicClientSessionBindingSchema.parse(input)).toThrow();
});
