"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MmtSDK = void 0;
const poolModule_1 = require("./modules/poolModule");
const positionModule_1 = require("./modules/positionModule");
const config_1 = require("./config");
const client_1 = require("@mysten/sui/client");
const routeModule_1 = require("./modules/routeModule");
const aggregatorModule_1 = require("./modules/aggregatorModule");
const mvrNamedPackagesPlugin_1 = require("./utils/mvr/mvrNamedPackagesPlugin");
class MmtSDK {
    /**
     * @deprecated use MmtSDK.NEW instead
     */
    constructor(suiClientUrl, packageId = '', isMainnet = true, mmtApiUrl = '', contractConst, client, customHeaders, mvrEndpoint) {
        if (client) {
            this.rpcModule = client;
        }
        else if (suiClientUrl) {
            this.rpcModule = new client_1.SuiClient({ url: suiClientUrl });
        }
        const network = isMainnet ? 'mainnet' : 'testnet';
        this.baseUrl = mmtApiUrl || config_1.Config.getDefaultMmtApiUrl(network);
        this.contractConst = contractConst || {
            ...config_1.Config.getDefaultClmmParams(network),
            ...(packageId ? { packageId } : {}),
        };
        this.customHeaders = customHeaders;
        this.poolModule = new poolModule_1.PoolModule(this);
        this.positionModule = new positionModule_1.PositionModule(this);
        this.routeModule = new routeModule_1.RouteModule(this);
        this.aggregatorModule = new aggregatorModule_1.AggregatorModule(this);
        this.mvrNamedPackagesPlugin = (0, mvrNamedPackagesPlugin_1.namedPackagesPlugin)({
            url: mvrEndpoint,
        });
    }
    static NEW(sdkParams) {
        if (sdkParams.network === 'custom' && !sdkParams?.contractConst) {
            throw new Error('missing contractConst for custom network');
        }
        const network = sdkParams?.network || 'mainnet';
        const clmm = sdkParams?.contractConst ?? { ...config_1.Config.getDefaultClmmParams(network) };
        const mmtApiUrl = sdkParams?.mmtApiUrl || config_1.Config.getDefaultMmtApiUrl(network);
        const suiClientUrl = sdkParams?.suiClientUrl || config_1.Config.getDefaultSuiClientUrl(network);
        const mvrEndpoint = sdkParams?.mvrEndpoint || config_1.Config.getDefaultMvrEndpoint(network);
        if (!suiClientUrl.trim() && !sdkParams?.client) {
            throw new Error('Either suiClientUrl or client must be provided');
        }
        return new MmtSDK(suiClientUrl, clmm.packageId, network !== 'testnet', mmtApiUrl, clmm, sdkParams?.client, sdkParams?.customHeaders, mvrEndpoint);
    }
    get rpcClient() {
        return this.rpcModule;
    }
    get Pool() {
        return this.poolModule;
    }
    get Position() {
        return this.positionModule;
    }
    get Route() {
        return this.routeModule;
    }
    get Aggregator() {
        return this.aggregatorModule;
    }
    get PackageId() {
        return this.contractConst.packageId;
    }
    get BaseUrl() {
        return this.baseUrl;
    }
}
exports.MmtSDK = MmtSDK;
