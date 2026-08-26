export type ContentCollection =
	| 'pages' | 'notes' | 'questions' | 'objectives' | 'proposals' | 'decisions'
	| 'people' | 'agents' | 'books' | 'docs' | 'templates' | 'workdays'
	| 'groups' | 'group_edges';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ColorSchemeId = 'fern' | 'lichen' | 'cedar' | 'tidepool' | (string & {});

export interface SemanticColorTokens {
	canvas: string;
	canvasSubtle: string;
	surface: string;
	surfaceMuted: string;
	surfaceRaised: string;
	surfaceOverlay: string;
	text: string;
	textMuted: string;
	textSubtle: string;
	textInverse: string;
	link: string;
	linkHover: string;
	border: string;
	borderMuted: string;
	borderStrong: string;
	focus: string;
	accent: string;
	accentHover: string;
	accentStrong: string;
	accentSoft: string;
	accentText: string;
	info: string;
	infoSoft: string;
	infoText: string;
	infoBorder: string;
	success: string;
	successSoft: string;
	successText: string;
	successBorder: string;
	warning: string;
	warningSoft: string;
	warningText: string;
	warningBorder: string;
	danger: string;
	dangerSoft: string;
	dangerText: string;
	dangerBorder: string;
	shadow: string;
	grid: string;
}

export interface SchemeTokens {
	light: SemanticColorTokens;
	dark: SemanticColorTokens;
}

export interface ThemeConfig {
	defaultScheme?: ColorSchemeId;
	defaultMode?: ThemeMode;
	schemes?: Record<string, Partial<{ light: Partial<SemanticColorTokens>; dark: Partial<SemanticColorTokens> }>>;
}

export type PlatformSurfaceName = 'web' | 'api' | (string & {});
export type PlatformResourceKind = 'pages' | 'styles' | 'components' | 'routes' | 'middleware' | 'handlers' | 'config';

export interface PlatformLayerDefinition {
	root: string;
	kinds?: PlatformResourceKind[];
}

export interface ManagedServiceEnvironmentConfig {
	baseUrl?: string;
	domain?: string;
	serviceName?: string;
	[key: string]: unknown;
}

export interface DeployConfig {
	content?: Record<string, unknown>;
	forms?: Record<string, unknown>;
	surfaces?: Record<string, unknown>;
	services?: Record<string, unknown>;
	[key: string]: any;
}

export interface TenantConfig {
	id?: string;
	name?: string;
	root?: string;
	content: Record<string, string | undefined>;
	features?: Record<string, boolean | undefined>;
	site?: { models?: Partial<Record<ContentCollection, { rendered?: boolean }>> };
	theme?: ThemeConfig;
	plugins?: Array<{ package: string; enabled?: boolean; config?: Record<string, unknown> }>;
	[key: string]: any;
}
