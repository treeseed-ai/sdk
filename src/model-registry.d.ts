import type { SdkModelDefinition, SdkModelName } from './sdk-types.ts';
export declare function buildModelRegistry(): Record<SdkModelName, SdkModelDefinition>;
export declare const MODEL_REGISTRY: Record<SdkModelName, SdkModelDefinition>;
export declare function resolveModelDefinition(model: string): SdkModelDefinition;
