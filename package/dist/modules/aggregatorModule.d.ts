import { BaseModule } from '../interfaces/BaseModule';
import { MmtSDK } from '../sdk';
import { TokenSchema } from '../types';
export interface SwapDataParams {
    userWalletAddress: string;
    fromTokenAddress: string;
    toTokenAddress: string;
    rawAmount: string;
    slippage?: string;
}
export interface QuoteParams {
    fromTokenAddress: string;
    toTokenAddress: string;
    rawAmount: string;
    slippage?: string;
    excludeDexIds?: string[];
}
export declare class AggregatorModule implements BaseModule {
    protected _sdk: MmtSDK;
    constructor(sdk: MmtSDK);
    get sdk(): MmtSDK;
    getAllOkxTokens(headers?: HeadersInit): Promise<TokenSchema[]>;
    fetchAllOkxTokensApi(baseUrl: string, headers?: HeadersInit): Promise<TokenSchema[]>;
    getAggregatorLiquidity(headers?: HeadersInit): Promise<any>;
    fetchLiquidityApi(baseUrl: string, headers?: HeadersInit): Promise<any>;
    getSwapData(params: SwapDataParams, headers?: HeadersInit): Promise<any>;
    fetchSwapDataApi(baseUrl: string, params: SwapDataParams, headers?: HeadersInit): Promise<any>;
    getQuote(params: QuoteParams, headers?: HeadersInit): Promise<any>;
    fetchQuoteApi(baseUrl: string, params: QuoteParams, headers?: HeadersInit): Promise<any>;
}
