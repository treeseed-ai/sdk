import { R2ApiTokenPublicationClient, type R2ApiTokenPublicationConfig } from './r2-api-token-publication-client.ts';
import { R2S3PublicationClient, type R2S3PublicationConfig } from './r2-s3-publication-client.ts';

export type R2PublicationConfig = R2ApiTokenPublicationConfig | (R2S3PublicationConfig & { authMode?: 's3' });
export type R2PublicationClient = Pick<R2S3PublicationClient, 'get' | 'exists' | 'put' | 'delete' | 'list'>;

export function createR2PublicationClient(config: R2PublicationConfig, fetchImpl: typeof fetch = fetch): R2PublicationClient {
	return config.authMode === 'api-token'
		? new R2ApiTokenPublicationClient(config, fetchImpl)
		: new R2S3PublicationClient(config, fetchImpl);
}
