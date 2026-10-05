import {z} from 'zod';
export const aiInstanceDraftSchema=z.object({
 name:z.string().trim().min(1).max(128),projectId:z.string().min(1).max(128),
 purpose:z.enum(['inference','training','both']),hostingConnectionId:z.string().min(1).max(128),
 storageConnectionId:z.string().min(1).max(128).nullable(),model:z.string().trim().min(1).max(512),
 schedule:z.enum(['always','weekdays']),timeZone:z.string().refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Use an IANA time zone.'),
}).strict().superRefine((value,context)=>{if(value.purpose!=='inference'&&!value.storageConnectionId)context.addIssue({code:'custom',path:['storageConnectionId'],message:'Training requires a storage connection.'});});
export type AiInstanceDraft=z.infer<typeof aiInstanceDraftSchema>;

/** Registration adopts an already managed local runtime; it never provisions a cloud machine. */
export const aiNodeRegistrationSchema = z.object({
 name:z.string().trim().min(1).max(128), projectId:z.string().uuid(),
 purpose:z.enum(['inference','training','both']), model:z.string().trim().min(1).max(512),
}).strict();
