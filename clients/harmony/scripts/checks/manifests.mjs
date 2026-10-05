// Check 1 -- manifest shape and cross-references, and Check 3 -- page and
// route integrity (brief section 7.1).
//
// Everything here is a structural assertion over the hand-parsed JSON5
// manifests (AppScope/app.json5, entry/src/main/module.json5,
// build-profile.json5, hvigor/hvigor-config.json5) plus the page/route
// tables (profile/main_pages.json, profile/router_map.json) and the ArkUI
// source that must agree with them.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseJson5 } from '../lib/json5.mjs';
import { walkFiles } from '../lib/walk.mjs';
import { collectResourceTree } from './resources.mjs';

const EXCLUDE_DIRS = ['build', 'oh_modules', 'node_modules', '.hvigor', '.git'];

const BUNDLE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+){2,}$/;
const BUNDLE_TYPES = new Set(['app', 'atomicService', 'shared', 'appService', 'appPlugin']);
const MODULE_TYPES = new Set(['entry', 'feature', 'har', 'shared']);
const EXPECTED_DEVICE_TYPES = ['phone', 'tablet', 'tv', '2in1'];
const FORBIDDEN_APP_JSON5_KEYS = [
  'minAPIVersion',
  'targetAPIVersion',
  'apiReleaseType',
  'debug',
  'multiProjects',
];

function toPosixRelative(harmonyDir, filePath) {
  return path.relative(harmonyDir, filePath).split(path.sep).join('/');
}

function readJson5(filePath) {
  const text = readFileSync(filePath, 'utf8');
  return parseJson5(text, filePath);
}

function findForbiddenKeys(value, forbidden, trail) {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((item, idx) => hits.push(...findForbiddenKeys(item, forbidden, [...trail, String(idx)])));
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (forbidden.includes(key)) {
        hits.push([...trail, key].join('.'));
      }
      hits.push(...findForbiddenKeys(value[key], forbidden, [...trail, key]));
    }
  }
  return hits;
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// -- Check 1: app.json5 -----------------------------------------------------

function checkAppJson5(harmonyDir, errors) {
  const appJsonPath = path.join(harmonyDir, 'AppScope/app.json5');
  if (!existsSync(appJsonPath)) {
    errors.push('AppScope/app.json5 is missing');
    return null;
  }
  const parsed = readJson5(appJsonPath);
  const app = parsed && parsed.app;
  if (!app || typeof app !== 'object') {
    errors.push('AppScope/app.json5: missing top-level "app" object');
    return null;
  }

  if (typeof app.bundleName !== 'string' || !BUNDLE_NAME_PATTERN.test(app.bundleName)) {
    errors.push(`AppScope/app.json5: app.bundleName '${app.bundleName}' does not match the required shape`);
  } else {
    const byteLength = Buffer.byteLength(app.bundleName, 'utf8');
    if (byteLength < 7 || byteLength > 128) {
      errors.push(`AppScope/app.json5: app.bundleName must be 7-128 bytes, got ${byteLength}`);
    }
  }

  if (!Number.isInteger(app.versionCode) || app.versionCode < 0 || app.versionCode > 2147483647) {
    errors.push(`AppScope/app.json5: app.versionCode must be an integer in 0..2147483647, got ${app.versionCode}`);
  }

  if (typeof app.versionName !== 'string' || Buffer.byteLength(app.versionName, 'utf8') > 127) {
    errors.push('AppScope/app.json5: app.versionName must be a string of at most 127 bytes');
  }

  if (!BUNDLE_TYPES.has(app.bundleType)) {
    errors.push(
      `AppScope/app.json5: app.bundleType '${app.bundleType}' is not one of {${[...BUNDLE_TYPES].join(', ')}}`
    );
  }

  const forbiddenHits = findForbiddenKeys(parsed, FORBIDDEN_APP_JSON5_KEYS, []);
  if (forbiddenHits.length > 0) {
    errors.push(
      `AppScope/app.json5: must not declare generated build-profile keys (${forbiddenHits.join(', ')}) -- these come from build-profile.json5`
    );
  }

  return { parsed, app };
}

// -- Check 1: module.json5 ---------------------------------------------------

function checkModuleJson5(harmonyDir, errors, stringResourceNames) {
  const modulePath = path.join(harmonyDir, 'entry/src/main/module.json5');
  if (!existsSync(modulePath)) {
    errors.push('entry/src/main/module.json5 is missing');
    return null;
  }
  const parsed = readJson5(modulePath);
  const mod = parsed && parsed.module;
  if (!mod || typeof mod !== 'object') {
    errors.push('entry/src/main/module.json5: missing top-level "module" object');
    return null;
  }

  if (!MODULE_TYPES.has(mod.type)) {
    errors.push(`module.json5: module.type '${mod.type}' is not one of {${[...MODULE_TYPES].join(', ')}}`);
  }

  if (!arraysEqual(mod.deviceTypes, EXPECTED_DEVICE_TYPES)) {
    errors.push(
      `module.json5: module.deviceTypes must be exactly ${JSON.stringify(EXPECTED_DEVICE_TYPES)}, got ${JSON.stringify(mod.deviceTypes)}`
    );
  }

  const abilities = Array.isArray(mod.abilities) ? mod.abilities : [];
  const matchingAbility = abilities.find((a) => a && a.name === mod.mainElement);
  if (!matchingAbility) {
    errors.push(`module.json5: module.mainElement '${mod.mainElement}' does not match any abilities[].name`);
  } else {
    if (typeof matchingAbility.srcEntry !== 'string') {
      errors.push(`module.json5: ability '${matchingAbility.name}' has no srcEntry`);
    } else {
      const srcEntryPath = path.join(harmonyDir, 'entry/src/main', matchingAbility.srcEntry);
      if (!existsSync(srcEntryPath)) {
        errors.push(
          `module.json5: ability '${matchingAbility.name}' srcEntry '${matchingAbility.srcEntry}' does not exist (expected ${toPosixRelative(harmonyDir, srcEntryPath)})`
        );
      }
    }
  }

  let homeAbilityCount = 0;
  for (const ability of abilities) {
    const skills = Array.isArray(ability && ability.skills) ? ability.skills : [];
    const hasHomeEntity = skills.some(
      (skill) => Array.isArray(skill && skill.entities) && skill.entities.includes('entity.system.home')
    );
    if (hasHomeEntity) homeAbilityCount += 1;
  }
  if (homeAbilityCount !== 1) {
    errors.push(`module.json5: exactly one ability must carry the 'entity.system.home' skill, found ${homeAbilityCount}`);
  }

  const permissions = Array.isArray(mod.requestPermissions) ? mod.requestPermissions : [];
  const hasInternet = permissions.some((p) => p && p.name === 'ohos.permission.INTERNET');
  if (!hasInternet) {
    errors.push("module.json5: module.requestPermissions must include 'ohos.permission.INTERNET'");
  }
  for (const permission of permissions) {
    if (!permission || typeof permission.reason !== 'string') continue;
    const match = /^\$string:([A-Za-z0-9_]+)$/.exec(permission.reason);
    if (!match) {
      errors.push(`module.json5: permission '${permission.name}' reason '${permission.reason}' is not a '$string:' resource reference`);
      continue;
    }
    if (!stringResourceNames.has(match[1])) {
      errors.push(`module.json5: permission '${permission.name}' reason '\$string:${match[1]}' does not resolve to a real string resource`);
    }
  }

  return { parsed, mod, abilities };
}

// -- Check 1: build-profile.json5 (root) -------------------------------------

function checkBuildProfileJson5(harmonyDir, errors) {
  const buildProfilePath = path.join(harmonyDir, 'build-profile.json5');
  if (!existsSync(buildProfilePath)) {
    errors.push('build-profile.json5 is missing');
    return;
  }
  const parsed = readJson5(buildProfilePath);
  const app = parsed && parsed.app;
  const products = Array.isArray(app && app.products) ? app.products : [];
  const signingConfigs = Array.isArray(app && app.signingConfigs) ? app.signingConfigs : [];
  const productNames = new Set(products.map((p) => p && p.name));
  const signingConfigNames = new Set(signingConfigs.map((s) => s && s.name));

  const modules = Array.isArray(parsed && parsed.modules) ? parsed.modules : [];
  for (const mod of modules) {
    if (!mod || typeof mod.srcPath !== 'string') {
      errors.push('build-profile.json5: a modules[] entry is missing srcPath');
      continue;
    }
    const srcPath = path.join(harmonyDir, mod.srcPath);
    if (!existsSync(srcPath) || !statSync(srcPath).isDirectory()) {
      errors.push(`build-profile.json5: modules[].srcPath '${mod.srcPath}' (module '${mod.name}') is not a directory`);
    }
    const targets = Array.isArray(mod.targets) ? mod.targets : [];
    for (const target of targets) {
      const applyTo = Array.isArray(target && target.applyToProducts) ? target.applyToProducts : [];
      for (const productName of applyTo) {
        if (!productNames.has(productName)) {
          errors.push(
            `build-profile.json5: target '${target.name}' applyToProducts '${productName}' does not match any app.products[].name`
          );
        }
      }
    }
  }

  for (const product of products) {
    if (!product) continue;
    // A product may omit signingConfig (unsigned build, signed afterwards by scripts/sign.sh).
    if (product.signingConfig !== undefined && !signingConfigNames.has(product.signingConfig)) {
      errors.push(`build-profile.json5: product '${product.name}' signingConfig '${product.signingConfig}' does not resolve to any app.signingConfigs[].name`);
    }
    if (typeof product.compatibleSdkVersion !== 'string' || !product.compatibleSdkVersion.startsWith('5.0.0(12)')) {
      errors.push(`build-profile.json5: product '${product.name}' compatibleSdkVersion must start with '5.0.0(12)', got '${product.compatibleSdkVersion}'`);
    }
  }
}

// -- Check 1: hvigor/hvigor-config.json5 -------------------------------------

function checkHvigorConfig(harmonyDir, errors) {
  const hvigorConfigPath = path.join(harmonyDir, 'hvigor/hvigor-config.json5');
  if (!existsSync(hvigorConfigPath)) {
    errors.push('hvigor/hvigor-config.json5 is missing');
    return;
  }
  const parsed = readJson5(hvigorConfigPath);
  const execution = parsed && parsed.execution;
  if (!execution || execution.typeCheck !== true) {
    errors.push("hvigor/hvigor-config.json5: execution.typeCheck must be exactly 'true'");
  }
}

// -- Check 3: page and route integrity ---------------------------------------

function checkPageAndRouteIntegrity(harmonyDir, errors, warnings) {
  const etsRoot = path.join(harmonyDir, 'entry/src/main/ets');
  const mainPagesPath = path.join(harmonyDir, 'entry/src/main/resources/base/profile/main_pages.json');
  const routerMapPath = path.join(harmonyDir, 'entry/src/main/resources/base/profile/router_map.json');

  let mainPages = null;
  if (existsSync(mainPagesPath)) {
    try {
      mainPages = JSON.parse(readFileSync(mainPagesPath, 'utf8'));
    } catch (err) {
      errors.push(`main_pages.json: failed to parse -- ${err.message}`);
    }
  } else {
    errors.push('entry/src/main/resources/base/profile/main_pages.json is missing');
  }

  let routerMap = null;
  if (existsSync(routerMapPath)) {
    try {
      routerMap = JSON.parse(readFileSync(routerMapPath, 'utf8'));
    } catch (err) {
      errors.push(`router_map.json: failed to parse -- ${err.message}`);
    }
  } else {
    errors.push('entry/src/main/resources/base/profile/router_map.json is missing');
  }

  const mainPagesSrc = new Set(Array.isArray(mainPages && mainPages.src) ? mainPages.src : []);

  // Every @Entry component's page path must be listed in main_pages.json.
  let pageFiles = [];
  if (existsSync(etsRoot)) {
    pageFiles = walkFiles(etsRoot, { include: [/\.ets$/i], exclude: EXCLUDE_DIRS });
  }
  for (const filePath of pageFiles) {
    const text = readFileSync(filePath, 'utf8');
    if (!/@Entry\b/.test(text)) continue;
    const relFromEts = path.relative(etsRoot, filePath).split(path.sep).join('/');
    const pagePath = relFromEts.replace(/\.ets$/i, '');
    if (mainPages && !mainPagesSrc.has(pagePath)) {
      errors.push(`${toPosixRelative(harmonyDir, filePath)}: @Entry page '${pagePath}' is not listed in main_pages.json`);
    }
  }

  // Every router_map.json entry's pageSourceFile must exist and export the
  // named buildFunction. hvigor resolves pageSourceFile relative to the module root
  // (entry/), not to src/main/ets.
  const routerRows = Array.isArray(routerMap && routerMap.routerMap) ? routerMap.routerMap : [];
  for (const row of routerRows) {
    if (!row || typeof row.pageSourceFile !== 'string') {
      errors.push('router_map.json: an entry is missing pageSourceFile');
      continue;
    }
    const pageSourcePath = path.join(harmonyDir, 'entry', row.pageSourceFile);
    if (!existsSync(pageSourcePath)) {
      errors.push(`router_map.json: pageSourceFile '${row.pageSourceFile}' (route '${row.name}') does not exist`);
      continue;
    }
    if (typeof row.buildFunction === 'string') {
      const text = readFileSync(pageSourcePath, 'utf8');
      const exportPattern = new RegExp(`export\\s+function\\s+${row.buildFunction}\\s*\\(`);
      if (!exportPattern.test(text)) {
        errors.push(
          `router_map.json: pageSourceFile '${row.pageSourceFile}' (route '${row.name}') does not export buildFunction '${row.buildFunction}'`
        );
      }
    }
  }

  // Route constants in navigation/Routes.ets must line up with
  // router_map.json, in both directions -- but navigation/ is a later
  // slice, so treat its absence as informational rather than fatal.
  const routesPath = path.join(harmonyDir, 'entry/src/main/ets/navigation/Routes.ets');
  if (!existsSync(routesPath)) {
    warnings.push("skipped Routes.ets <-> router_map.json cross-check -- 'navigation/Routes.ets' does not exist yet");
    return;
  }

  const routesText = readFileSync(routesPath, 'utf8');
  const routeConstantPattern = /export\s+const\s+[A-Za-z0-9_]+\s*[:=][^;]*?["']([^"']+)["']/g;
  const routeConstants = new Set();
  let m;
  while ((m = routeConstantPattern.exec(routesText)) !== null) {
    routeConstants.add(m[1]);
  }
  const routerMapNames = new Set(routerRows.map((row) => row && row.name).filter((n) => typeof n === 'string'));

  for (const routeName of routeConstants) {
    if (!routerMapNames.has(routeName)) {
      errors.push(`navigation/Routes.ets: route '${routeName}' has no matching router_map.json entry`);
    }
  }
  for (const routeName of routerMapNames) {
    if (!routeConstants.has(routeName)) {
      errors.push(`router_map.json: route '${routeName}' has no matching constant in navigation/Routes.ets`);
    }
  }
}

export function checkManifests(harmonyDir) {
  const errors = [];
  const warnings = [];

  checkAppJson5(harmonyDir, errors);

  const resourceTree = collectResourceTree(harmonyDir);
  checkModuleJson5(harmonyDir, errors, new Set(resourceTree.string.keys()));

  checkBuildProfileJson5(harmonyDir, errors);
  checkHvigorConfig(harmonyDir, errors);
  checkPageAndRouteIntegrity(harmonyDir, errors, warnings);

  return { ok: errors.length === 0, errors, warnings };
}
