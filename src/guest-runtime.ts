import { z } from 'zod';

class GuestRuntimeShapes {
  static readonly partLimit = 7 * 1024 * 1024;
  static readonly hash = z.string().regex(/^[a-f0-9]{64}$/);
  static readonly libraries = z.enum([
    'ld-linux-x86-64.so.2',
    'libc.so.6',
    'libdl.so.2',
    'libm.so.6',
    'libpthread.so.0',
  ]);
  static readonly part = z.strictObject({
    file: z.string().regex(/^trsd-agent-guest\.[0-9]{3}\.gzpart$/),
    size: z.number().int().min(1).max(this.partLimit),
    sha256: this.hash,
  });
  static unique(values: string[]): boolean {
    return new Set(values).size === values.length;
  }
}
/** Portable artifact metadata only; byte verification, custody and staging belong to Deployment. */
export class GuestRuntimeSchemas {
  static readonly version = '1.0.0-cordis.1';
  static readonly manifest = z.strictObject({
    schemaVersion: z.literal('treeseed.guest-runtime/v1'),
    compiler: z.literal('bun@1.4.4'),
    target: z.literal('bun-linux-x64-baseline'),
    os: z.literal('linux'),
    architecture: z.literal('amd64'),
    interpreter: z.literal('/lib64/ld-linux-x86-64.so.2'),
    requiredLibraries: z
      .array(GuestRuntimeShapes.libraries)
      .length(5)
      .refine(GuestRuntimeShapes.unique)
      .meta({ uniqueItems: true }),
    compressed: z.strictObject({
      format: z.literal('gzip'),
      size: z
        .number()
        .int()
        .min(1)
        .max(64 * 1024 * 1024),
      sha256: GuestRuntimeShapes.hash,
      parts: z.array(GuestRuntimeShapes.part).min(1).max(16),
    }),
    executable: z.strictObject({
      mode: z.literal(0o755),
      size: z
        .number()
        .int()
        .min(64)
        .max(128 * 1024 * 1024),
      sha256: GuestRuntimeShapes.hash,
    }),
  });
}
export type GuestRuntimeManifest = z.infer<typeof GuestRuntimeSchemas.manifest>;
export class GuestRuntimeContractError extends Error {
  readonly code = 'INVALID_GUEST_RUNTIME';
  constructor() {
    super('INVALID_GUEST_RUNTIME');
    this.name = 'GuestRuntimeContractError';
  }
}
export class GuestRuntimeBinding {
  static assert(input: unknown): GuestRuntimeManifest {
    const result = GuestRuntimeSchemas.manifest.safeParse(input);
    if (!result.success) throw new GuestRuntimeContractError();
    this.parts(result.data.compressed);
    return result.data;
  }
  private static parts(stream: GuestRuntimeManifest['compressed']): void {
    let size = 0;
    for (const [index, part] of stream.parts.entries()) {
      const expected = 'trsd-agent-guest.' + String(index).padStart(3, '0') + '.gzpart';
      if (part.file !== expected) throw new GuestRuntimeContractError();
      if (index < stream.parts.length - 1 && part.size !== GuestRuntimeShapes.partLimit)
        throw new GuestRuntimeContractError();
      size += part.size;
    }
    if (size !== stream.size) throw new GuestRuntimeContractError();
  }
}
