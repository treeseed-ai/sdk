import { validRange } from 'semver';
export type PluginLocator = {
    kind: 'npm';
    name: string;
    selector: string;
} | {
    kind: 'git';
    url: string;
    ref: string | null;
};
/** Syntax only. Resolution, publisher trust and execution belong to Deployment. */
export class PluginSource {
    static parse(value: string): PluginLocator {
        if (typeof value !== 'string' || value.length < 1 || value.length > 2048 || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value))
            throw new Error('INVALID_PLUGIN_SOURCE');
        if (value.startsWith('https://')) {
            try {
                const url = new URL(value), ref = url.hash ? decodeURIComponent(url.hash.slice(1)) : null;
                if (url.protocol !== 'https:' || url.username || url.password || url.search || !url.hostname || !/^\/(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\.git)?$/.test(url.pathname) || /\.(tgz|zip|gz)$/.test(url.pathname) || value.includes('%') || /(?:^|\/)\.{1,2}(?:\/|#|$)/.test(value) || value.endsWith('#') || (ref !== null && (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(ref) || ref.includes('..') || ref.includes('/.') || ref.endsWith('/') || ref.endsWith('.') || ref.endsWith('.lock'))))
                    throw new Error();
                return { kind: 'git', url: url.origin + url.pathname, ref };
            }
            catch {
                throw new Error('INVALID_PLUGIN_SOURCE');
            }
        }
        const match = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@([a-zA-Z0-9*^~<>=][a-zA-Z0-9.*^~<>=|+_ -]*))?$/.exec(value);
        if (!match || /\s--?[a-zA-Z]/.test(value) || match[1]!.length > 214 || match[2]?.endsWith(' '))
            throw new Error('INVALID_PLUGIN_SOURCE');
        const selector = match[2] ?? 'latest';
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(selector) && validRange(selector) === null)
            throw new Error('INVALID_PLUGIN_SOURCE');
        return { kind: 'npm', name: match[1]!, selector };
    }
    static valid(value: string): boolean {
        try {
            PluginSource.parse(value);
            return true;
        }
        catch {
            return false;
        }
    }
    static https(value: string): boolean {
        try {
            if (value !== value.trim() || /[\x00-\x1f\x7f]/.test(value))
                return false;
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
        }
        catch {
            return false;
        }
    }
}
