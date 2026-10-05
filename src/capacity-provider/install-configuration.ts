import { z } from 'zod';

/** Portable enrollment inputs only. Never embed a host identity or administrator session. */
export const capacityInstallConfigurationSchema = z.object({
  schemaVersion: z.literal('treeseed.capacity-install-configuration/v1'),
  profile: z.literal('capacity-provider'),
  teamId: z.string().min(1).max(256),
  registrationGeneration: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  inputs: z.object({
    controlPlaneUrl: z.string().url().refine(value => {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    }, 'Use a trusted HTTPS control-plane URL without credentials, query or fragment.'),
    teamRegistrationCode: z.string().min(16).max(16384).regex(/^[^\s]+$/u),
  }).strict(),
}).strict();
