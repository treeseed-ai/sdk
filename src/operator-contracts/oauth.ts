import type { OAuthScope } from './control-plane-operation.ts';

export const TREESEED_OAUTH_CLIENT_IDS = {
	cli: 'trsd',
	admin: 'treeseed-admin',
} as const;

export type TreeSeedOAuthClientId = typeof TREESEED_OAUTH_CLIENT_IDS[keyof typeof TREESEED_OAUTH_CLIENT_IDS];

export interface ApiPrincipal {
	id: string;
	displayName?: string;
	scopes: string[];
	roles: string[];
	permissions: string[];
	metadata?: Record<string, unknown>;
}

export interface OAuthAuthorizationServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	device_authorization_endpoint: string;
	revocation_endpoint: string;
	response_types_supported: ['code'];
	grant_types_supported: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'];
	code_challenge_methods_supported: ['S256'];
	scopes_supported: OAuthScope[];
}

export interface OAuthAuthorizationPresentation {
	schemaVersion: 'treeseed.oauth.authorization-presentation/v1';
	clientId: string;
	clientName: string;
	redirectUri: string;
	redirectOrigin: string;
	responseType: 'code';
	codeChallenge: string;
	codeChallengeMethod: 'S256';
	scopes: OAuthScope[];
	state: string | null;
}

export interface OAuthAuthorizationDecisionRequest {
	clientId: string;
	redirectUri: string;
	responseType: 'code';
	codeChallenge: string;
	codeChallengeMethod: 'S256';
	scope: OAuthScope[];
	state?: string | null;
	decision: 'approve' | 'deny';
	identifier?: string;
	password?: string;
}

export interface OAuthAuthorizationDecisionResult {
	schemaVersion: 'treeseed.oauth.authorization-decision/v1';
	approved: boolean;
	redirectTo: string;
	expiresIn?: number;
}

export interface OAuthProtectedResourceMetadata {
	resource: string;
	authorization_servers: string[];
	scopes_supported: OAuthScope[];
	bearer_methods_supported: ['header'];
}

export interface OAuthDeviceAuthorizationRequest {
	clientId: string;
	scope: OAuthScope[];
}

export interface OAuthDeviceAuthorizationResponse {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	expiresIn: number;
	interval: number;
}

export interface OAuthTokenReceipt {
	tokenType: 'Bearer';
	accessToken: string;
	expiresIn: number;
	refreshToken?: string;
	scope: OAuthScope[];
	audience: string;
}
