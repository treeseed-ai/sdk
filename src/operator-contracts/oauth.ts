import type { OAuthScope } from './control-plane-operation.ts';

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
