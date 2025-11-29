import { ExtendedPoolWithApr, PathResult, PoolTokenType, TokenSchema } from '../types';
import { BaseModule } from '../interfaces/BaseModule';
import { MmtSDK } from '../sdk';
export declare class RouteModule implements BaseModule {
    protected _sdk: MmtSDK;
    constructor(sdk: MmtSDK);
    get sdk(): MmtSDK;
    fetchRoute(sourceToken: string, targetToken: string, amount: bigint, extendedPools?: ExtendedPoolWithApr[], tokens?: TokenSchema[]): Promise<{
        path: string[];
        output: bigint;
    }>;
    private getRoutes;
    private buildGraphFromPools;
    private simplifyPath;
    private extractPoolInfo;
    private sortPaths;
    devRunSwapAndChooseBestRoute(paths: PathResult[], pools: PoolTokenType[], sourceAmount: bigint): Promise<{
        path: string[];
        output: bigint;
    }>;
    private dryRunSwap;
}
