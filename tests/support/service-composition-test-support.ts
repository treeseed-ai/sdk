import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
export class ServiceCompositionTests {
  service(serviceId:string):object {
    const provider={pluginId:'fixture',providerId:'fixture',target:'deployment',package:{name:'@test/service',version:'1.0.0',sha256:'a'.repeat(64)},entry:'dist/service.js',classExport:'FixturePlugin',contractVersion:'0.4.0-cordis.1'};
    return {serviceId,provider,configuration:{},definition:{imageId:'fixture',command:['serve'],environment:{},ports:[{id:'http',target:8080}],volumes:[],secrets:[],workerSocket:false},bindings:[{port:'http',bindingId:serviceId,contractId:'fixture.echo',contractVersion:'1.0.0'}],dependencies:[],readiness:{provider,configuration:{},endpoint:{serviceId,portId:'http'},deadlineMs:5000,observationContract:'fixture.echo'},resources:{volumes:[],slots:{}},transitionPolicy:{kind:'additive',stateVersion:1}};
  }
}
