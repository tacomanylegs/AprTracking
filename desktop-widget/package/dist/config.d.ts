export declare const MainnetConfig: {
    clmm: {
        packageId: string;
        publishedAt: string;
        aclId: string;
        adminCapId: string;
        slippageCheckPackageId: string;
        globalConfigId: string;
        versionId: string;
        mvrName: string;
    };
    mmtApiUrl: string;
    suiClientUrl: string;
    mvrEndpoint: string;
};
export declare const TestnetConfig: {
    clmm: {
        packageId: string;
        publishedAt: string;
        aclId: string;
        adminCapId: string;
        slippageCheckPackageId: string;
        globalConfigId: string;
        versionId: string;
        mvrName: string;
    };
    mmtApiUrl: string;
    suiClientUrl: string;
    mvrEndpoint: string;
};
export declare class Config {
    static getDefaultClmmParams(network: string): {
        packageId: string;
        publishedAt: string;
        aclId: string;
        adminCapId: string;
        slippageCheckPackageId: string;
        globalConfigId: string;
        versionId: string;
        mvrName: string;
    };
    static getDefaultMmtApiUrl(network: string): string;
    static getDefaultSuiClientUrl(network: string): string;
    static getDefaultMvrEndpoint(network: string): string;
}
