interface CacheEntry {
    value: string;
    expire: number;
}
export declare const DEFAULT_MVR_TIMEOUT: number;
export interface MvrCache {
    packages: Record<string, string>;
    types: Record<string, string>;
}
export declare class MvrCacheLocal {
    packageCache: Record<string, CacheEntry>;
    typeCache: Record<string, CacheEntry>;
    constructor();
    mergeWithOverrides(overrides: MvrCache): MvrCache;
    addFetchedResult(fetched: MvrCache, expire?: number): void;
}
export declare const mvrCacheLocal: MvrCacheLocal;
export {};
