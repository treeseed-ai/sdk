import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const name = z.string().trim().min(1).max(128);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const time = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u);

/** Public intent only: credentials are resolved at execution, never serialized here. */
export const aiHostingScheduleSchema = z.object({
  timeZone: z.string().refine(value => { try { new Intl.DateTimeFormat('en', {timeZone:value}); return true; } catch { return false; } }, 'Use an IANA time zone.'),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  start: time, end: time,
  startupLeadMinutes: z.number().int().min(0).max(120),
  idleAction: z.literal('hibernate'),
  activeWorkPolicy: z.literal('drain-and-checkpoint'),
}).strict().superRefine((value, context) => {
  if (new Set(value.weekdays).size !== value.weekdays.length) context.addIssue({code:'custom',path:['weekdays'],message:'Choose each weekday once.'});
  if (value.start >= value.end) context.addIssue({code:'custom',path:['end'],message:'End must follow start on the same local day.'});
});

const storage = z.object({
  bindingId: id,
  purpose: z.enum(['datasets', 'models', 'checkpoints', 'artifacts']),
  access: z.enum(['read', 'write']),
}).strict();
const component = z.object({componentId:z.enum(['ai-inference','ai-training']), releaseDigest:digest}).strict();
export const aiHostingDeploymentSchema = z.object({
  schemaVersion: z.literal('treeseed.ai-hosting-deployment/v1'),
  teamId:id, projectId:id, deploymentId:id,
  environment:z.enum(['staging','production']),
  provider:z.literal('hyperstack'), hostingBindingId:id,
  components:z.array(component).min(1).max(2),
  machine:z.object({name, environmentName:name, flavorName:name, imageName:name, keypairName:name, volumeName:name}).strict(),
  gpuAdmission:z.literal('exclusive-engine'),
  storage:z.array(storage).min(1).max(16),
  schedule:aiHostingScheduleSchema.optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.components.map(item=>item.componentId)).size !== value.components.length)
    context.addIssue({code:'custom',path:['components'],message:'Each engine can be selected once.'});
  if (!value.storage.some(item=>item.purpose==='models'&&item.access==='read'))
    context.addIssue({code:'custom',path:['storage'],message:'An authorized model read binding is required.'});
  if (value.components.some(item=>item.componentId==='ai-training')) {
    for (const [purpose,access] of [['datasets','read'],['checkpoints','write']] as const)
      if (!value.storage.some(item=>item.purpose===purpose&&item.access===access))
        context.addIssue({code:'custom',path:['storage'],message:`Training requires ${purpose} ${access} access.`});
  }
});
export type AiHostingDeployment = z.infer<typeof aiHostingDeploymentSchema>;
export type AiHostingSchedule = z.infer<typeof aiHostingScheduleSchema>;

/** Engine selection is independent from the infrastructure provider or credentials. */
export const AI_HOSTING_TARGETS = [
  {id:'ai-inference', project:'ai', engine:'vllm', capability:'ai-inference-hosting', runtimeOwner:'ai', infrastructureOwner:'deployment'},
  {id:'ai-training', project:'ai', engine:'axolotl', capability:'ai-training-hosting', runtimeOwner:'ai', infrastructureOwner:'deployment'},
] as const;
