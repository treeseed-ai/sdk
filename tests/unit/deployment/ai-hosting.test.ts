import {describe,it,expect} from 'vitest';
import {aiHostingDeploymentSchema,aiHostingScheduleSchema,AI_HOSTING_TARGETS} from '../../../src/deployment/ai-hosting.ts';
import {capacityInstallConfigurationSchema} from '../../../src/capacity-provider/install-configuration.ts';
import {getServiceProviderDefinition} from '../../../src/secrets-capability/service-provider-contracts.ts';
const declaration = {schemaVersion:'treeseed.ai-hosting-deployment/v1',teamId:'team',projectId:'project',deploymentId:'gpu',environment:'staging',provider:'hyperstack',hostingBindingId:'hosting',
  components:[{componentId:'ai-inference',releaseDigest:`sha256:${'a'.repeat(64)}`}],machine:{name:'gpu',environmentName:'environment',flavorName:'flavor',imageName:'image',keypairName:'key',volumeName:'volume'},gpuAdmission:'exclusive-engine',
  storage:[{bindingId:'models',purpose:'models',access:'read'}]};
describe('AI hosting contract',()=>{
  it('keeps inference/training in one account without advertising capacity hosting',()=>{
    const provider=getServiceProviderDefinition('hyperstack')!;
    expect(provider.capabilities.map(item=>item.type)).toEqual(AI_HOSTING_TARGETS.map(item=>item.capability));
    expect(provider.credentialProfiles).toHaveLength(1);
    expect(provider.connectionFields).toEqual([]);
    expect(getServiceProviderDefinition('railway')!.capabilities.some(item=>item.type==='capacity-runtime-hosting')).toBe(false);
  });
  it('requires exact artifacts and forbids embedded credentials and arbitrary cloud-init',()=>{
    expect(aiHostingDeploymentSchema.safeParse(declaration).success).toBe(true);
    for(const addition of [{apiToken:'secret'},{userData:'script'}]) expect(aiHostingDeploymentSchema.safeParse({...declaration,...addition}).success).toBe(false);
    expect(aiHostingDeploymentSchema.safeParse({...declaration,components:[{componentId:'ai-inference',releaseDigest:'latest'}]}).success).toBe(false);
  });
  it('requires dataset reads and durable checkpoint writes for training and both',()=>{
    for(const components of [[{componentId:'ai-training',releaseDigest:`sha256:${'b'.repeat(64)}`}],[...declaration.components,{componentId:'ai-training',releaseDigest:`sha256:${'b'.repeat(64)}`}]] ){
      expect(aiHostingDeploymentSchema.safeParse({...declaration,components}).success).toBe(false);
      expect(aiHostingDeploymentSchema.safeParse({...declaration,components,storage:[...declaration.storage,{bindingId:'data',purpose:'datasets',access:'read'},{bindingId:'checkpoints',purpose:'checkpoints',access:'write'}]}).success).toBe(true);
    }
  });
  it('rejects invalid timezone, repeated weekdays and ambiguous overnight windows',()=>{
    const schedule={timeZone:'America/New_York',weekdays:[1,2,3,4,5],start:'09:00',end:'17:00',startupLeadMinutes:30,idleAction:'hibernate',activeWorkPolicy:'drain-and-checkpoint'};
    expect(aiHostingScheduleSchema.safeParse(schedule).success).toBe(true);
    for(const change of [{timeZone:'invalid'},{weekdays:[1,1]},{end:'08:00'},{idleAction:'stop'}]) expect(aiHostingScheduleSchema.safeParse({...schedule,...change}).success).toBe(false);
  });
});
describe('capacity configuration download',()=>{
  const config={schemaVersion:'treeseed.capacity-install-configuration/v1',profile:'capacity-provider',teamId:'team',registrationGeneration:1,generatedAt:'2026-09-06T12:00:00.000Z',inputs:{controlPlaneUrl:'https://api.example.test',teamRegistrationCode:'registration-code-fixture'}};
  it('contains only portable enrollment inputs',()=>{
    expect(capacityInstallConfigurationSchema.safeParse(config).success).toBe(true);
    expect(capacityInstallConfigurationSchema.safeParse({...config,hostId:'fixed-host'}).success).toBe(false);
  });
  it('rejects unsafe addresses without leaking values',()=>{
    for(const controlPlaneUrl of ['http://api.test','https://user:password@api.test','https://api.test?token=secret','https://api.test#fragment'])
      expect(capacityInstallConfigurationSchema.safeParse({...config,inputs:{...config.inputs,controlPlaneUrl}}).success).toBe(false);
  });
});
