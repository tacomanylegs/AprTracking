"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mvrCacheLocal = exports.MvrCacheLocal = exports.DEFAULT_MVR_TIMEOUT = void 0;
exports.DEFAULT_MVR_TIMEOUT = 60 * 1000; // 60s
class MvrCacheLocal {
    constructor() {
        this.packageCache = {};
        this.typeCache = {};
    }
    mergeWithOverrides(overrides) {
        const res = {
            packages: {},
            types: {},
        };
        const copyFromOverrides = (source, target) => {
            for (const [key, value] of Object.entries(source)) {
                if (key && value) {
                    target[key] = value;
                }
            }
        };
        const copyFromThis = (source, target) => {
            for (const [key, { value, expire }] of Object.entries(source)) {
                if (Date.now() < expire) {
                    target[key] = value;
                }
            }
        };
        copyFromOverrides(overrides.packages, res.packages);
        copyFromOverrides(overrides.types, res.types);
        copyFromThis(this.packageCache, res.packages);
        copyFromThis(this.typeCache, res.types);
        return res;
    }
    addFetchedResult(fetched, expire = Date.now() + exports.DEFAULT_MVR_TIMEOUT) {
        for (const [key, value] of Object.entries(fetched.packages)) {
            this.packageCache[key] = { value, expire };
        }
        for (const [key, value] of Object.entries(fetched.types)) {
            this.typeCache[key] = { value, expire };
        }
    }
}
exports.MvrCacheLocal = MvrCacheLocal;
exports.mvrCacheLocal = new MvrCacheLocal();
