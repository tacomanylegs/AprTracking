import { PoolModule } from './modules/poolModule';
import { PositionModule } from './modules/positionModule';
import { ClmmConsts } from './types';
import { SuiClient } from '@mysten/sui/client';
import { RouteModule } from './modules/routeModule';
import { AggregatorModule } from './modules/aggregatorModule';
import { BuildTransactionOptions, TransactionDataBuilder } from '@mysten/sui/transactions';
export declare class MmtSDK {
    protected readonly rpcModule: SuiClient;
    protected readonly poolModule: PoolModule;
    protected readonly positionModule: PositionModule;
    protected readonly routeModule: RouteModule;
    protected readonly aggregatorModule: AggregatorModule;
    readonly baseUrl: string;
    readonly contractConst: ClmmConsts;
    readonly customHeaders?: HeadersInit;
    readonly mvrNamedPackagesPlugin: (transactionData: TransactionDataBuilder, _buildOptions: BuildTransactionOptions, next: () => Promise<void>) => Promise<void>;
    /**
     * @deprecated use MmtSDK.NEW instead
     */
    constructor(suiClientUrl: string, packageId?: string, isMainnet?: boolean, mmtApiUrl?: string, contractConst?: ClmmConsts, client?: SuiClient, customHeaders?: HeadersInit, mvrEndpoint?: string);
    static NEW(sdkParams?: {
        network?: 'mainnet' | 'testnet' | 'custom';
        contractConst?: ClmmConsts;
        mmtApiUrl?: string;
        suiClientUrl?: string;
        client?: SuiClient;
        customHeaders?: HeadersInit;
        mvrEndpoint?: string;
    }): MmtSDK;
    get rpcClient(): SuiClient;
    get Pool(): PoolModule;
    get Position(): PositionModule;
    get Route(): RouteModule;
    get Aggregator(): AggregatorModule;
    get PackageId(): string;
    get BaseUrl(): string;
}
