import { TransactionArgument, Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { PoolParams, TickLiquidity, ExtendedPool, Rewarder, TokenSchema, ExtendedPoolWithApr, PreSwapParam } from '../types';
import { MmtSDK } from '../sdk';
import { BaseModule } from '../interfaces/BaseModule';
import BN from 'bn.js';
import Decimal from 'decimal.js';
export declare const Q_64 = "18446744073709551616";
export declare class PoolModule implements BaseModule {
    protected _sdk: MmtSDK;
    constructor(sdk: MmtSDK);
    get sdk(): MmtSDK;
    createPool(txb: Transaction, fee_rate: number, price: string, coinXType: string, coinYType: string, decimalsX: number, decimalsY: number, useMvr?: boolean): void;
    swap(txb: Transaction, pool: PoolParams, amount: bigint | TransactionArgument, inputCoin: TransactionArgument, isXtoY: boolean, transferToAddress?: string, limitSqrtPrice?: bigint, useMvr?: boolean): import("@mysten/sui/transactions").TransactionResult;
    /**
     * @params txb: Transaction
     * @params pool: PoolParams
     * @params amount: bigint | TransactionArgument
     * @params inputCoin: any
     * @params isXtoY: boolean
     * @params transferToAddress?: string
     * @params limitSqrtPrice?: bigint
     * @params useMvr?: boolean
     *
     * @returns: if transferToAddress is provided, all the coins will be transferred to the address
     * @returns: if transferToAddress is not provided, the outputCoin will be returned, and leftover of inputCoin will be returned
     * {
     *  outputCoin: TransactionObjectArgument;
     *  leftoverCoin: TransactionObjectArgument;
     * }
     */
    swapV2({ txb, pool, amount, inputCoin, isXtoY, transferToAddress, limitSqrtPrice, useMvr, }: {
        txb: Transaction;
        pool: PoolParams;
        amount: bigint | TransactionArgument;
        inputCoin: TransactionArgument;
        isXtoY: boolean;
        transferToAddress?: string;
        limitSqrtPrice?: bigint;
        useMvr?: boolean;
    }): {
        outputCoin: import("@mysten/sui/transactions").TransactionResult;
        leftoverCoin: TransactionArgument;
    };
    flashSwap(txb: Transaction, pool: PoolParams, amountX: bigint, amountY: bigint, inputCoin: any, transferToAddress?: string, useMvr?: boolean): import("@mysten/sui/transactions").TransactionResult;
    removeLiquidity(txb: Transaction, pool: PoolParams, positionId: string, liquidity: bigint | TransactionArgument, min_amount_x: bigint, min_amount_y: bigint, transferToAddress?: string, useMvr?: boolean): {
        removeLpCoinA: {
            $kind: "NestedResult";
            NestedResult: [number, number];
        };
        removeLpCoinB: {
            $kind: "NestedResult";
            NestedResult: [number, number];
        };
    };
    addLiquidity(txb: Transaction, pool: PoolParams, position: string | TransactionArgument, coinX: string | TransactionArgument, coinY: string | TransactionArgument, min_amount_x: bigint, min_amount_y: bigint, transferToAddress?: string, useMvr?: boolean): Promise<{
        coinA: {
            $kind: "NestedResult";
            NestedResult: [number, number];
        };
        coinB: {
            $kind: "NestedResult";
            NestedResult: [number, number];
        };
    }>;
    addLiquiditySingleSided(txb: Transaction, pool: PoolParams, position: string | TransactionArgument, inputCoin: TransactionObjectArgument, min_amount_x: bigint, min_amount_y: bigint, isXtoY: boolean, transferToAddress?: string, limitSqrtPrice?: bigint, useMvr?: boolean): Promise<void>;
    simulateSwapResultBeforeAddLiquiditySingleSided({ pool, inputAmountInBaseUnits, isXtoY, limitSqrtPrice, position, txb, useMvr, }: {
        txb: Transaction;
        pool: PoolParams & {
            tokenXDecimals: number;
            tokenYDecimals: number;
        };
        inputAmountInBaseUnits: bigint;
        isXtoY: boolean;
        limitSqrtPrice: bigint;
        position: string | TransactionArgument;
        useMvr: boolean;
    }): Promise<{
        tokenXAmount: string;
        tokenYAmount: string;
        tokenXPercent: string;
        tokenYPercent: string;
    }>;
    /**
     * @param txb - Transaction builder
     * @param amount - Amount of coin to calculate slippage for
     * @param slippagePercentage - Slippage percentage (1 = 1%, 0.01 = 0.01%)
     * @description min_amount = amount * (1 - slippagePercentage / 100)
     */
    private _calcMinAmountUsingSlippage;
    /**
     * @description Add liquidity with single sided token
     * @param txb - Transaction builder
     * @param pool - Pool parameters
     * @param position - Position ID
     * @param inputCoin - Input coin, the single sided token
     * @param isXtoY - Whether the input coin is X or Y
     * @param transferToAddress - Address to transfer the output coin to
     * @param limitSqrtPrice - Limit sqrt price, it's calculated by swap slippage
     * @param slippagePercentage - Slippage percentage (1 = 1%, 0.01 = 0.01%)
     */
    addLiquiditySingleSidedV2({ txb, pool, position, inputCoin, isXtoY, transferToAddress, limitSqrtPrice, slippagePercentage, useMvr, }: {
        txb: Transaction;
        pool: PoolParams;
        position: string | TransactionArgument;
        inputCoin: TransactionObjectArgument;
        isXtoY: boolean;
        transferToAddress: string;
        limitSqrtPrice?: bigint;
        slippagePercentage: number;
        useMvr?: boolean;
    }): Promise<void>;
    private _formatReturnU64ValueToAmount;
    private _formatAmountWithDecimals;
    private _decodeReturnU64Value;
    collectFee(txb: Transaction, pool: PoolParams, positionId: string | TransactionArgument, transferToAddress?: string, useMvr?: boolean): {
        feeCoinA: {
            $kind: "NestedResult";
            NestedResult: [number, number];
        };
        feeCoinB: {
            $kind: "NestedResult";
            NestedResult: [number, number];
        };
    };
    collectReward(txb: Transaction, pool: PoolParams, positionId: string | TransactionArgument, rewardCoinType: string, transferToAddress?: string, useMvr?: boolean): {
        $kind: "NestedResult";
        NestedResult: [number, number];
    };
    collectAllRewards(txb: Transaction, pool: PoolParams, rewarders: Rewarder[], positionId: string | TransactionArgument, transferToAddress?: string): any[];
    private _getUserAllPositionObjects;
    collectAllPoolsRewards(userAddress: string, pools: ExtendedPool[]): Promise<Transaction>;
    fetchRewardsAndFee(positions: any, pools: ExtendedPool[], address: string): Promise<Transaction>;
    migratevSuiPosition(vSuiPositionId: string, range: number, txb: Transaction, transferToAddress: string, useMvr?: boolean): Promise<void>;
    getAllPools(headers?: HeadersInit, validate?: boolean): Promise<ExtendedPoolWithApr[]>;
    getPool(poolId: string, headers?: HeadersInit, validate?: boolean): Promise<ExtendedPoolWithApr>;
    private validatePoolsId;
    private calcRewardApr;
    getAllTokens(headers?: HeadersInit): Promise<TokenSchema[]>;
    getToken(tokenId: string, headers?: HeadersInit): Promise<TokenSchema>;
    fetchAllTickLiquidities(poolId: string, reverse?: boolean, headers?: HeadersInit): Promise<TickLiquidity[]>;
    fetchTickLiquidity(poolId: string, offset: number, limit: number, reverse?: boolean, headers?: HeadersInit): Promise<any>;
    getRewardersApy(poolId: string, headers?: HeadersInit): Promise<import("../types").RewardersAPYSchema>;
    estPositionAPRWithDeltaMethod(currentTickIndex: number, lowerTickIndex: number, upperTickIndex: number, currentSqrtPriceX64: BN, poolLiquidity: BN, decimalsA: number, decimalsB: number, feeRate: number, amountAStr: string, amountBStr: string, swapVolumeStr: string, coinAPriceStr: string, coinBPriceStr: string, poolRewarders: any[]): {
        feeAPR: Decimal;
        rewarderApr: any[];
    };
    estPositionAPRWithLiquidityHM(currentTickIndex: number, lowerTickIndex: number, upperTickIndex: number, currentSqrtPriceX64: BN, poolLiquidity: BN, poolLiquidityHM: BN, decimalsA: number, decimalsB: number, feeRate: number, amountAStr: string, amountBStr: string, swapVolumeStr: string, coinAPriceStr: string, coinBPriceStr: string, poolRewarders: any[]): {
        feeAPR: Decimal;
        rewarderApr: any[];
    };
    calcLiquidityAmounts(amountA: Decimal, amountB: Decimal, decimalsA: number, decimalsB: number, currentSqrtPriceD: Decimal, lowerSqrtPriceD: Decimal, upperSqrtPriceD: Decimal): {
        liquidityAmount0: Decimal;
        liquidityAmount1: Decimal;
    };
    getPosValidTVL(deltaLiquidity: Decimal, currentSqrtPriceD: Decimal, lowerSqrtPriceD: Decimal, upperSqrtPriceD: Decimal, decimalsA: number, decimalsB: number, coinAPrice: Decimal, coinBPrice: Decimal): Decimal;
    calculatePoolValidTVL(amountA: BN, amountB: BN, decimalsA: number, decimalsB: number, coinAPrice: Decimal, coinBPrice: Decimal): Decimal;
    getRewardsAPY(pool: ExtendedPool, tokensInput?: TokenSchema[]): Promise<{
        feeAPR: Decimal;
        rewarderApr: any[];
    } | {
        feeAPR: string;
        rewarderApr: any[];
    }>;
    getPoolAPY(pool: ExtendedPool, tokensInput?: TokenSchema[]): Promise<{
        feeAPR: Decimal;
        rewarderApr: {
            rewarderApr: Decimal;
            coinType: string;
            amountPerDay: Decimal;
        }[];
    } | {
        feeAPR: string;
        rewarderApr: any[];
    }>;
    preSwap(tx: Transaction, pools: PreSwapParam[], sourceAmount: any): Promise<bigint>;
    private calculatePoolAPR;
    time: number;
    private _findRouteAndSwap;
    /**
     * @description:
     * claim fee as a single coin
     *
     * @params txb: Transaction
     * @params pool: PoolParams
     * @params positionId: string | TransactionArgument
     * @params targetCoinType: string
     * @params slippage: number // 1 = 1%
     * @params toAddress: string
     * @params useMvr?: boolean
     * @returns:
     * if toAddress is provided, all the coins will be transferred to the address
     * if toAddress is not provided, the outputCoin will be returned, and leftover of inputCoin will be returned
     * {
     *  outputCoin: TransactionObjectArgument;
     *  leftoverCoin: TransactionObjectArgument;
     * }
     */
    claimFeeAs({ txb, pool, positionId, targetCoinType, slippage, useMvr, toAddress, pools, }: {
        txb: Transaction;
        pool: PoolParams;
        positionId: string | TransactionArgument;
        targetCoinType: string;
        slippage: number;
        toAddress: string;
        useMvr?: boolean;
        pools?: ExtendedPoolWithApr[];
    }): Promise<TransactionObjectArgument>;
    claimRewardsAs({ txb, pool, positionId, rewarderCoinTypes, targetCoinType, slippage, toAddress, useMvr, pools, }: {
        txb: Transaction;
        pool: PoolParams;
        positionId: string | TransactionArgument;
        rewarderCoinTypes: string[];
        targetCoinType: string;
        slippage: number;
        toAddress: string;
        useMvr?: boolean;
        pools?: ExtendedPoolWithApr[];
    }): Promise<TransactionObjectArgument>;
    getMinTickRangeFactor(poolIds: string[], coinXTypes: string[], coinYTypes: string[], useMvr?: boolean): Promise<Array<{
        poolId: string;
        minTickRangeFactor: number;
    }>>;
}
