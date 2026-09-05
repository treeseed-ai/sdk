import { describe, expect, it } from 'vitest';
import { hostConfigurationSchema } from '../../../src/deployment/schemas.ts';
describe('host OS custody contracts',()=>{
  it('rejects unimplemented external secret providers without aliases',()=>{
    const schema=hostConfigurationSchema.shape.secrets;
    for(const provider of ['vault','aws-secrets-manager','openbao'])
      expect(schema.safeParse({bootstrap:{provider,reference:'external-secret'}}).success).toBe(false);
    for(const provider of ['file','systemd-credential'])
      expect(schema.safeParse({bootstrap:{provider,reference:'/run/treeseed/credentials/bootstrap'}}).success).toBe(true);
  });
});
