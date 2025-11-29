"use strict";
// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.namedPackagesPlugin = void 0;
const utils_1 = require("@mysten/sui/utils");
const utils_2 = require("./utils");
const mvr_cache_local_1 = require("./mvr-cache-local");
/**
 * @experimental This plugin is in experimental phase and there might be breaking changes in the future
 *
 * Adds named resolution so that you can use .move names in your transactions.
 * e.g. `@org/app::type::Type` will be resolved to `0x1234::type::Type`.
 * This plugin will resolve all names & types in the transaction block.
 *
 * To install this plugin globally in your app, use:
 * ```
 * Transaction.registerGlobalSerializationPlugin("namedPackagesPlugin", namedPackagesPlugin({ suiGraphQLClient }));
 * ```
 *
 * You can also define `overrides` to pre-populate name resolutions locally (removes the GraphQL request).
 */
const namedPackagesPlugin = ({ url, pageSize = 50, overrides = { packages: {}, types: {} }, }) => {
    // validate that types are first-level only.
    Object.keys(overrides.types).forEach((type) => {
        if ((0, utils_1.parseStructTag)(type).typeParams.length > 0) {
            throw new Error('Type overrides must be first-level only. If you want to supply generic types, just pass each type individually.');
        }
    });
    const cache = mvr_cache_local_1.mvrCacheLocal.mergeWithOverrides(overrides);
    return async (transactionData, _buildOptions, next) => {
        const names = (0, utils_2.findNamesInTransaction)(transactionData);
        const [packages, types] = await Promise.all([
            resolvePackages(names.packages.filter((x) => !cache.packages[x]), url, pageSize),
            resolveTypes([...(0, utils_2.getFirstLevelNamedTypes)(names.types)].filter((x) => !cache.types[x]), url, pageSize),
        ]);
        // save first-level mappings to cache.
        Object.assign(cache.packages, packages);
        Object.assign(cache.types, types);
        // Also write the result to local cache
        mvr_cache_local_1.mvrCacheLocal.addFetchedResult({ packages, types });
        const composedTypes = (0, utils_2.populateNamedTypesFromCache)(names.types, cache.types);
        // when replacing names, we also need to replace the "composed" types collected above.
        (0, utils_2.replaceNames)(transactionData, {
            packages: { ...cache.packages },
            // we include the "composed" type cache too.
            types: composedTypes,
        });
        await next();
    };
    // eslint-disable-next-line @typescript-eslint/no-shadow
    async function resolvePackages(packages, apiUrl, pageSize) {
        if (packages.length === 0) {
            return {};
        }
        const batches = (0, utils_2.batch)(packages, pageSize);
        const results = {};
        await Promise.all(batches.map(async (nameBatch) => {
            const response = await fetch(`${apiUrl}/v1/resolution/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    names: nameBatch,
                }),
            });
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                throw new Error(`Failed to resolve packages: ${errorBody?.message}`);
            }
            const data = await response.json();
            if (!data?.resolution) {
                return;
            }
            // eslint-disable-next-line no-restricted-syntax
            for (const pkg of Object.keys(data?.resolution)) {
                const pkgData = data.resolution[pkg]?.package_id;
                if (!pkgData) {
                    continue;
                }
                results[pkg] = pkgData;
            }
        }));
        return results;
    }
    // eslint-disable-next-line @typescript-eslint/no-shadow
    async function resolveTypes(types, apiUrl, pageSize) {
        if (types.length === 0) {
            return {};
        }
        const batches = (0, utils_2.batch)(types, pageSize);
        const results = {};
        await Promise.all(batches.map(async (nameBatch) => {
            const response = await fetch(`${apiUrl}/v1/struct-definition/bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    types: nameBatch,
                }),
            });
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                throw new Error(`Failed to resolve types: ${errorBody?.message}`);
            }
            const data = await response.json();
            if (!data?.resolution) {
                return;
            }
            // eslint-disable-next-line no-restricted-syntax
            for (const type of Object.keys(data?.resolution)) {
                const typeData = data.resolution[type]?.type_tag;
                if (!typeData) {
                    continue;
                }
                results[type] = typeData;
            }
        }));
        return results;
    }
};
exports.namedPackagesPlugin = namedPackagesPlugin;
