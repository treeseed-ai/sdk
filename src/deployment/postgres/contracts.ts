import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/u);
const sqlName = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/u)
  .refine(value => value !== 'postgres' && !value.startsWith('pg_'), 'Application identifiers must not use PostgreSQL administrative names.');
const unique = <T>(values: T[]) => new Set(values).size === values.length;

/** Package-owned requirements, not an instruction to start another server. */
export const postgresRequirementSchema = z.object({
  id, componentId: id, enabled: z.boolean(),
  supportedMajors: z.array(z.number().int().min(14).max(99)).nonempty().refine(unique),
  extensions: z.array(sqlName).refine(unique),
  runtimeConnectionLimit: z.number().int().min(1).max(1000),
}).strict();

/** Immutable component requirement. Installation activation supplies componentId/enabled. */
export const postgresComponentRequirementSchema = postgresRequirementSchema.omit({ componentId: true, enabled: true });

/** Deployment owns the selected server and its bootstrap authority. No credentials here. */
export const postgresServerSchema = z.object({
  id, installationId: id, environment: z.enum(['staging', 'production']),
  mode: z.enum(['shared', 'dedicated', 'external']),
  hostname: z.string().max(253).regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u),
  port: z.number().int().min(1).max(65535),
  major: z.number().int().min(14).max(99),
  extensions: z.array(sqlName).refine(unique),
  tls: z.object({ mode: z.literal('verify-full'), trustReference: id }).strict(),
}).strict();

export const postgresAllocationSchema = z.object({
  requirementId: id, serverId: id, database: sqlName,
  ownerRole: sqlName, migrationRole: sqlName, runtimeRole: sqlName,
  migrationCredentialReference: id, runtimeCredentialReference: id,
  onDisable: z.literal('preserve'),
}).strict().superRefine((value, context) => {
  if (!unique([value.ownerRole, value.migrationRole, value.runtimeRole])) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Owner, migration and runtime roles must be distinct.' });
  if (value.migrationCredentialReference === value.runtimeCredentialReference) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Migration and runtime credentials must be distinct.' });
});

/** One installation/environment. Explicit allocations may select dedicated servers. */
export const postgresTopologySchema = z.object({
  schemaVersion: z.literal('treeseed.postgres-topology/v1'),
  installationId: id, environment: z.enum(['staging', 'production']),
  servers: z.array(postgresServerSchema), requirements: z.array(postgresRequirementSchema),
  allocations: z.array(postgresAllocationSchema),
}).strict().superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (!unique(value.servers.map(server => server.id)) || !unique(value.requirements.map(requirement => requirement.id)) || !unique(value.allocations.map(allocation => allocation.requirementId))) fail('Server, requirement and allocation identities must be unique.');
  if (value.servers.filter(server => server.mode === 'shared').length > 1) fail('An environment has at most one default shared server.');
  if (value.servers.some(server => server.installationId !== value.installationId || server.environment !== value.environment)) fail('Servers must belong to this installation and environment.');
  const databases = new Set<string>(), roles = new Set<string>();
  for (const allocation of value.allocations) {
    const server = value.servers.find(entry => entry.id === allocation.serverId);
    const requirement = value.requirements.find(entry => entry.id === allocation.requirementId);
    if (!server || !requirement) { fail('Allocation references an unknown server or requirement.'); continue; }
    if (!requirement.supportedMajors.includes(server.major) || requirement.extensions.some(extension => !server.extensions.includes(extension))) fail('Server does not satisfy package version/extension requirements.');
    const databaseKey = `${server.id}:${allocation.database}`;
    if (databases.has(databaseKey)) fail('Applications must not share an allocated database.');
    databases.add(databaseKey);
    for (const role of [allocation.ownerRole, allocation.migrationRole, allocation.runtimeRole]) {
      const key = `${server.id}:${role}`;
      if (roles.has(key)) fail('Applications must not share database roles.');
      roles.add(key);
    }
  }
  for (const requirement of value.requirements) {
    if (requirement.enabled && !value.allocations.some(allocation => allocation.requirementId === requirement.id)) fail('Enabled database requirements need explicit allocations.');
  }
});

export type PostgresRequirement = z.infer<typeof postgresRequirementSchema>;
export type PostgresServer = z.infer<typeof postgresServerSchema>;
export type PostgresAllocation = z.infer<typeof postgresAllocationSchema>;
export type PostgresTopology = z.infer<typeof postgresTopologySchema>;
