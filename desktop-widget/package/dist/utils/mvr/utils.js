"use strict";
// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.findNamesInTransaction = findNamesInTransaction;
exports.getFirstLevelNamedTypes = getFirstLevelNamedTypes;
exports.populateNamedTypesFromCache = populateNamedTypesFromCache;
exports.replaceNames = replaceNames;
exports.batch = batch;
exports.applyMvrPackage = applyMvrPackage;
const utils_1 = require("@mysten/sui/utils");
const NAME_SEPARATOR = '/';
// export type NameResolutionRequest = {
//   id: number;
//   type: 'package' | 'moveType';
//   name: string;
// };
/**
 * Looks up all `.move` names in a transaction block.
 * Returns a list of all the names found.
 */
function findNamesInTransaction(builder) {
    const packages = new Set();
    const types = new Set();
    // eslint-disable-next-line no-restricted-syntax
    for (const command of builder.commands) {
        if (command.MakeMoveVec?.type) {
            getNamesFromTypeList([command.MakeMoveVec.type]).forEach((type) => {
                types.add(type);
            });
            continue;
        }
        if (!('MoveCall' in command)) {
            continue;
        }
        const tx = command.MoveCall;
        if (!tx) {
            continue;
        }
        const pkg = tx.package.split('::')[0];
        if (hasMvrName(pkg)) {
            if (!(0, utils_1.isValidNamedPackage)(pkg)) {
                throw new Error(`Invalid package name: ${pkg}`);
            }
            packages.add(pkg);
        }
        getNamesFromTypeList(tx.typeArguments ?? []).forEach((type) => {
            types.add(type);
        });
    }
    return {
        packages: [...packages],
        types: [...types],
    };
}
/**
 * Extracts all first-level types from a list of types.
 * E.g. for the input `['@mvr/demo::a::A<@mvr/demo::b::B>']`,
 * the output will be `['@mvr/demo::a::A', '@mvr/demo::b::B']`.
 */
function getFirstLevelNamedTypes(types) {
    const results = new Set();
    // eslint-disable-next-line no-restricted-syntax
    for (const type of types) {
        findMvrNames(type).forEach((name) => results.add(name));
    }
    return results;
}
/**
 * Extracts all named types from a given type.
 */
function findMvrNames(type) {
    const types = new Set();
    if (typeof type === 'string' && !hasMvrName(type)) {
        return types;
    }
    const tag = isStructTag(type) ? type : (0, utils_1.parseStructTag)(type);
    if (hasMvrName(tag.address)) {
        types.add(`${tag.address}::${tag.module}::${tag.name}`);
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const param of tag.typeParams) {
        findMvrNames(param).forEach((name) => types.add(name));
    }
    return types;
}
// /**
//  * Allows partial replacements of known types with their resolved equivalents.
//  * E.g. `@mvr/demo::a::A<@mvr/demo::b::B>` can be resolved, if we already have
//  * the address for `@mvr/demo::b::B` and the address for `@mvr/demo::a::A`,
//  * without the need to have the full type in the cache.
//  *
//  * Returns the fully composed resolved types (if any) in a `named-type -> normalized-type` map.
//  */
function populateNamedTypesFromCache(types, typeCache) {
    const composedTypes = {};
    types.forEach((type) => {
        const normalized = (0, utils_1.normalizeStructTag)(findAndReplaceCachedTypes(type, typeCache));
        composedTypes[type] = normalized;
    });
    return composedTypes;
}
/**
 * Traverses a type, and replaces any found names with their resolved equivalents,
 * based on the supplied type cache.
 */
function findAndReplaceCachedTypes(tag, typeCache) {
    const type = isStructTag(tag) ? tag : (0, utils_1.parseStructTag)(tag);
    const typeTag = `${type.address}::${type.module}::${type.name}`;
    const cacheHit = typeCache[typeTag];
    return {
        ...type,
        address: cacheHit ? cacheHit.split('::')[0] : type.address,
        typeParams: type.typeParams.map((param) => findAndReplaceCachedTypes(param, typeCache)),
    };
}
/**
 * Replace all names & types in a transaction block
 * with their resolved names/types.
 */
function replaceNames(builder, cache) {
    // eslint-disable-next-line no-restricted-syntax
    for (const command of builder.commands) {
        // Replacements for `MakeMoveVec` commands (that can include types)
        if (command.MakeMoveVec?.type) {
            if (!hasMvrName(command.MakeMoveVec.type)) {
                continue;
            }
            if (!cache.types[command.MakeMoveVec.type]) {
                throw new Error(`No resolution found for type: ${command.MakeMoveVec.type}`);
            }
            command.MakeMoveVec.type = cache.types[command.MakeMoveVec.type];
        }
        // Replacements for `MoveCall` commands (that can include packages & types)
        const tx = command.MoveCall;
        if (!tx) {
            continue;
        }
        const nameParts = tx.package.split('::');
        const name = nameParts[0];
        if (hasMvrName(name) && !cache.packages[name]) {
            throw new Error(`No address found for package: ${name}`);
        }
        // Replace package name with address.
        if (hasMvrName(name)) {
            nameParts[0] = cache.packages[name];
            tx.package = nameParts.join('::');
        }
        const types = tx.typeArguments;
        if (!types) {
            continue;
        }
        for (let i = 0; i < types.length; i++) {
            if (!hasMvrName(types[i])) {
                continue;
            }
            if (!cache.types[types[i]]) {
                throw new Error(`No resolution found for type: ${types[i]}`);
            }
            types[i] = cache.types[types[i]];
        }
        tx.typeArguments = types;
    }
}
function batch(arr, size) {
    const batches = [];
    for (let i = 0; i < arr.length; i += size) {
        batches.push(arr.slice(i, i + size));
    }
    return batches;
}
/**
 * Returns a list of unique types that include a name
 * from the given list. This list is retrieved from the Transaction Data.
 */
function getNamesFromTypeList(types) {
    const names = new Set();
    // eslint-disable-next-line no-restricted-syntax
    for (const type of types) {
        if (hasMvrName(type)) {
            if (!(0, utils_1.isValidNamedType)(type)) {
                throw new Error(`Invalid type with names: ${type}`);
            }
            names.add(type);
        }
    }
    return names;
}
function hasMvrName(nameOrType) {
    return (nameOrType.includes(NAME_SEPARATOR) || nameOrType.includes('@') || nameOrType.includes('.sui'));
}
function isStructTag(type) {
    return (typeof type === 'object' &&
        'address' in type &&
        'module' in type &&
        'name' in type &&
        'typeParams' in type);
}
function applyMvrPackage(txb, sdk, useMvr) {
    if (useMvr) {
        txb.addSerializationPlugin(sdk.mvrNamedPackagesPlugin);
        return sdk.contractConst.mvrName;
    }
    return sdk.PackageId;
}
