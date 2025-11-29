"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteModule = void 0;
const transactions_1 = require("@mysten/sui/transactions");
const cc_graph_1 = require("@syntsugar/cc-graph");
const constants_1 = require("../utils/constants");
class RouteModule {
    constructor(sdk) {
        this._sdk = sdk;
    }
    get sdk() {
        return this._sdk;
    }
    async fetchRoute(sourceToken, targetToken, amount, extendedPools, tokens) {
        if (amount <= 0n) {
            return null;
        }
        if (!extendedPools?.length) {
            extendedPools = await this._sdk.Pool.getAllPools();
        }
        const sourceTokenSchema = tokens?.length
            ? tokens.find((token) => token.coinType === sourceToken)
            : await this._sdk.Pool.getToken(sourceToken);
        if (!extendedPools?.length || !sourceTokenSchema) {
            throw new Error('No pools or source token found');
        }
        const pools = extendedPools
            .filter((pool) => Number(pool.tvl) > 0)
            .map((pool) => ({
            poolId: pool.poolId,
            tokenXType: pool.tokenXType,
            tokenYType: pool.tokenYType,
            tvl: pool.tvl,
        }));
        const pathResults = this.getRoutes(sourceToken, targetToken, pools);
        if (!pathResults) {
            console.error('No paths found:', sourceToken, targetToken);
            return null;
        }
        const best = await this.devRunSwapAndChooseBestRoute(pathResults, pools, amount);
        if (!best) {
            console.info('No valid swap paths found:', 'sourceToken:', sourceToken, 'targetToken:', targetToken, 'amount:', amount);
            return null;
        }
        return best;
    }
    getRoutes(sourceToken, targetToken, pools) {
        const graph = new cc_graph_1.Graph(false);
        const vertexMap = new Map();
        const tokenRepeatTracker = new Map();
        let edgeToPool = new Map();
        let poolWeightMap = new Map();
        this.buildGraphFromPools(pools, graph, vertexMap, tokenRepeatTracker, edgeToPool, poolWeightMap);
        const fromVertex = vertexMap.get(sourceToken);
        const toVertex = vertexMap.get(targetToken);
        if (!fromVertex || !toVertex)
            return null;
        const paths = Array.from(graph.findAllPath(fromVertex, toVertex));
        const pathResults = [];
        for (const path of paths) {
            const tokenNames = path.map((v) => (v.value.includes('#') ? v.value.split('#')[0] : v.value));
            const simplified = this.simplifyPath(tokenNames);
            const { poolIds, isXToY } = this.extractPoolInfo(path, edgeToPool);
            pathResults.push({ tokens: simplified, pools: poolIds, isXToY });
        }
        const sorted = this.sortPaths(pathResults, poolWeightMap).slice(0, constants_1.DRY_RUN_PATH_LEN);
        if (sorted.length === 0) {
            console.warn('No valid paths found');
            return null;
        }
        return sorted;
    }
    buildGraphFromPools(pools, graph, vertexMap, tokenRepeatTracker, edgeToPool, poolWeightMap) {
        const tokenSet = new Set();
        pools.forEach((pool) => {
            tokenSet.add(pool.tokenXType);
            tokenSet.add(pool.tokenYType);
        });
        tokenSet.forEach((token) => {
            vertexMap.set(token, new cc_graph_1.GraphVertex(token));
        });
        const fetchAvailableTokenKey = (token) => {
            const count = tokenRepeatTracker.get(token) ?? 0;
            const nextCount = count + 1;
            tokenRepeatTracker.set(token, nextCount);
            return `${token}#${nextCount}`;
        };
        const addEdge = (from, to, pool, weight) => {
            let finalTo = to;
            const fromVertex = vertexMap.get(from);
            let toVertex = vertexMap.get(finalTo);
            if (graph.findEdge(fromVertex, toVertex)) {
                finalTo = fetchAvailableTokenKey(to);
                vertexMap.set(finalTo, new cc_graph_1.GraphVertex(finalTo));
                const virtualVertex = vertexMap.get(finalTo);
                graph.addEdge(new cc_graph_1.GraphEdge(virtualVertex, toVertex, 0));
            }
            toVertex = vertexMap.get(finalTo);
            graph.addEdge(new cc_graph_1.GraphEdge(fromVertex, toVertex, weight));
            edgeToPool.set(`${from}->${finalTo}`, pool);
            poolWeightMap.set(`${from}->${finalTo}`, weight);
        };
        for (const pool of pools) {
            const weight = 1 / Math.log(Number(pool.tvl) + 1);
            addEdge(pool.tokenXType, pool.tokenYType, pool, weight);
        }
    }
    simplifyPath(tokenNames) {
        const simplified = [];
        for (let i = 0; i < tokenNames.length; i++) {
            if (i === 0 || tokenNames[i] !== tokenNames[i - 1]) {
                simplified.push(tokenNames[i]);
            }
        }
        return simplified;
    }
    extractPoolInfo(path, edgeToPool) {
        const poolIds = [];
        const isXToY = [];
        for (let i = 0; i < path.length - 1; i++) {
            const from = path[i].value;
            const to = path[i + 1].value;
            const edgeKey = `${from}->${to}`;
            const edgeKeyRev = `${to}->${from}`;
            const pool = edgeToPool.get(edgeKey) ?? edgeToPool.get(edgeKeyRev);
            if (!pool)
                continue;
            poolIds.push(pool.poolId);
            isXToY.push(pool.tokenXType === from);
        }
        return { poolIds, isXToY };
    }
    sortPaths(paths, poolWeightMap) {
        const getWeightSum = (tokens) => tokens.slice(0, -1).reduce((sum, _, idx) => {
            const key1 = `${tokens[idx]}->${tokens[idx + 1]}`;
            const key2 = `${tokens[idx + 1]}->${tokens[idx]}`;
            const weight = poolWeightMap.get(key1) ?? poolWeightMap.get(key2) ?? 0;
            return sum + weight;
        }, 0);
        return [...paths].sort((a, b) => {
            const lenA = a.tokens.length;
            const lenB = b.tokens.length;
            if (lenA !== lenB) {
                return lenA - lenB;
            }
            const weightA = getWeightSum(a.tokens);
            const weightB = getWeightSum(b.tokens);
            return weightB - weightA;
        });
    }
    async devRunSwapAndChooseBestRoute(paths, pools, sourceAmount) {
        const tasks = paths.map(async (path) => {
            const tx = new transactions_1.Transaction();
            const amountIn = sourceAmount > constants_1.U64_MAX ? constants_1.U64_MAX : sourceAmount;
            let output = 0n;
            try {
                output = await this.dryRunSwap(tx, path, pools, amountIn.toString());
            }
            catch (err) {
                console.info('Error in dry run swap:', err);
            }
            return { path, output };
        });
        const results = await Promise.all(tasks);
        const validResults = results.filter((r) => r !== null);
        if (validResults.length === 0) {
            console.warn('No valid swap paths found.');
            return null;
        }
        const best = validResults.reduce((max, current) => current.output > max.output ? current : max);
        return { path: best.path.pools, output: best.output };
    }
    async dryRunSwap(tx, pathResult, pools, sourceAmount) {
        const preSwapParams = [];
        for (let i = 0; i < pathResult.pools.length; i++) {
            const poolId = pathResult.pools[i];
            const isXtoY = pathResult.isXToY?.[i] ?? true;
            const pool = pools.find((p) => p.poolId === poolId);
            preSwapParams.push({
                tokenXType: pool.tokenXType,
                tokenYType: pool.tokenYType,
                poolId: pool.poolId,
                isXtoY,
            });
        }
        return this.sdk.Pool.preSwap(tx, preSwapParams, sourceAmount);
    }
}
exports.RouteModule = RouteModule;
