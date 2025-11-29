"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatorModule = void 0;
class AggregatorModule {
    constructor(sdk) {
        this._sdk = sdk;
    }
    get sdk() {
        return this._sdk;
    }
    async getAllOkxTokens(headers) {
        const tokens = await this.fetchAllOkxTokensApi(this.sdk.baseUrl, {
            ...this.sdk.customHeaders,
            ...headers,
        });
        return tokens;
    }
    async fetchAllOkxTokensApi(baseUrl, headers) {
        const defaultHeaders = {
            'Content-Type': 'application/json',
        };
        const mergedHeaders = { ...defaultHeaders, ...headers };
        const options = {
            method: 'GET',
            headers: mergedHeaders,
            body: null,
        };
        const response = await fetch(`${baseUrl}/aggregator/tokens`, options);
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        return (await response.json())?.data;
    }
    async getAggregatorLiquidity(headers) {
        return this.fetchLiquidityApi(this.sdk.baseUrl, {
            ...this.sdk.customHeaders,
            ...headers,
        });
    }
    async fetchLiquidityApi(baseUrl, headers) {
        const defaultHeaders = { 'Content-Type': 'application/json' };
        const mergedHeaders = { ...defaultHeaders, ...headers };
        const options = {
            method: 'GET',
            headers: mergedHeaders,
            body: null,
        };
        const response = await fetch(`${baseUrl}/aggregator/liquidity`, options);
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        return (await response.json())?.data;
    }
    async getSwapData(params, headers) {
        return this.fetchSwapDataApi(this.sdk.baseUrl, params, {
            ...this.sdk.customHeaders,
            ...headers,
        });
    }
    async fetchSwapDataApi(baseUrl, params, headers) {
        const defaultHeaders = { 'Content-Type': 'application/json' };
        const mergedHeaders = { ...defaultHeaders, ...headers };
        const url = new URL(`${baseUrl}/aggregator/swap-data`);
        Object.keys(params).forEach((key) => url.searchParams.append(key, params[key]));
        const options = {
            method: 'GET',
            headers: mergedHeaders,
        };
        const response = await fetch(url.toString(), options);
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        return (await response.json())?.data;
    }
    async getQuote(params, headers) {
        return this.fetchQuoteApi(this.sdk.baseUrl, params, {
            ...this.sdk.customHeaders,
            ...headers,
        });
    }
    async fetchQuoteApi(baseUrl, params, headers) {
        const defaultHeaders = { 'Content-Type': 'application/json' };
        const mergedHeaders = { ...defaultHeaders, ...headers };
        const url = new URL(`${baseUrl}/aggregator/quote`);
        if (params.excludeDexIds) {
            url.searchParams.append('excludeDexIds', params.excludeDexIds.join(','));
        }
        Object.keys(params).forEach((key) => {
            if (key !== 'excludeDexIds') {
                url.searchParams.append(key, params[key]);
            }
        });
        const options = {
            method: 'GET',
            headers: mergedHeaders,
        };
        const response = await fetch(url.toString(), options);
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        return (await response.json())?.data;
    }
}
exports.AggregatorModule = AggregatorModule;
