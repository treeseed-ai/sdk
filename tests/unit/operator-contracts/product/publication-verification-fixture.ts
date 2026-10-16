import type {PublishedSourceAttempt} from '../../../acceptance/product/test-chain.ts';

/** Controlled public observations; native callers supply original Git identities. */
export function publicationVerificationFixture(base='a'.repeat(40),commit='b'.repeat(40),branch='simulation/tester'){
 const attempt:PublishedSourceAttempt={id:'attempt',teamId:'team',projectId:'sdk',attempt:1,provider:{providerId:'provider'},workspace:{mode:'git',repository:'treeseed-ai/sdk',baseCommit:base,branch,writablePaths:['tests']}};
 const reference={kind:'git' as const,repository:'treeseed-ai/sdk',commit,branch},repository='/var/lib/treeseed/agent/workspaces/simulations/'+'c'.repeat(64)+'.git';
 const source={controlPlaneId:'control',teamId:'team',projectId:'sdk',repositoryId:'repository',commit:base,formatVersion:1,profile:'source-only'};
 const entry=(metadata:Record<string,unknown>)=>({name:'sandbox-test.json',type:'file',digest:'d'.repeat(64),metadata});
 const journals={jobs:{rootPresent:true,entries:[entry({schemaVersion:'treeseed.assignment-source-job/v1',leaseId:'lease',owner:{assignmentId:attempt.id,providerId:attempt.provider.providerId,teamId:attempt.teamId,projectId:attempt.projectId,attempt:1}})]},
  results:{rootPresent:true,entries:[entry({schemaVersion:'treeseed.source-result/v1',sandboxId:'sandbox-test',leaseId:'lease',status:'completed',teardownVerified:true,source:structuredClone(source),sourceReference:reference,simulationRepository:repository})]},
  candidates:{rootPresent:true,entries:[entry({state:'published',assignmentId:attempt.id,attempt:1,providerId:attempt.provider.providerId,leaseId:'lease',source:structuredClone(source),commit,digest:'sha256:'+'e'.repeat(64),verifierId:'sandbox-warm-22222222-2222-4222-8222-222222222222',verifierStopped:true,
   verification:{baseCommit:base,commit,bytes:100,clean:true,objectClosure:true,ancestry:true,isolatedVerifier:true}})]}};
 return{attempt,reference,repository,workspace:{complete:true,errors:[]as string[],scope:{storageRoot:'/var/lib/treeseed/agent/workspaces'},journals,confirmation:{journals:structuredClone(journals)}}};
}
