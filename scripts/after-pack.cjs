/**
 * after-pack.cjs
 *
 * electron-builder afterPack hook.
 *
 * Responsibilities:
 *   1. Copy build/openclaw/node_modules into packaged resources (electron-builder
 *      skips it because .gitignore contains "node_modules/").
 *   2. Bundle OpenClaw plugins from node_modules into packaged resources.
 *   3. General cleanup (dev artifacts, docs, tests, source maps).
 *   4. Platform-specific cleanup (koffi, native packages).
 *   5. Verify critical transitive deps are in the asar (before-pack copies them
 *      as real dirs so electron-builder includes them naturally).
 *   6. Clean up before-pack's temporary copies.
 */

const { cpSync, existsSync, readdirSync, rmSync, statSync, mkdirSync, realpathSync } = require('fs');
const { join, dirname, basename } = require('path');

// Windows long-path prefix
function normWin(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  return '\\\\?\\' + p.replace(/\//g, '\\');
}

// electron-builder Arch enum: 0=ia32, 1=x64, 2=armv7l, 3=arm64, 4=universal
const ARCH_MAP = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
function resolveArch(archEnum) { return ARCH_MAP[archEnum] || 'x64'; }

// ── General cleanup ──────────────────────────────────────────────────────────

function cleanupUnnecessaryFiles(dir) {
  let removedCount = 0;
  const REMOVE_DIRS = new Set([
    'test', 'tests', '__tests__', '.github', 'examples', 'example',
  ]);
  const REMOVE_FILE_EXTS = ['.d.ts', '.d.ts.map', '.js.map', '.mjs.map', '.ts.map', '.markdown'];
  const REMOVE_FILE_NAMES = new Set([
    '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
    'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
  ]);

  function walk(currentDir) {
    let entries;
    try { entries = readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (REMOVE_DIRS.has(entry.name)) {
          try { rmSync(fullPath, { recursive: true, force: true }); removedCount++; } catch { /* */ }
        } else {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const name = entry.name;
        if (REMOVE_FILE_NAMES.has(name) || REMOVE_FILE_EXTS.some(e => name.endsWith(e))) {
          try { rmSync(fullPath, { force: true }); removedCount++; } catch { /* */ }
        }
      }
    }
  }

  walk(dir);
  return removedCount;
}

// ── Platform-specific: koffi ─────────────────────────────────────────────────

function cleanupKoffi(nodeModulesDir, platform, arch) {
  const koffiDir = join(nodeModulesDir, 'koffi', 'build', 'koffi');
  if (!existsSync(koffiDir)) return 0;
  const keepTarget = `${platform}_${arch}`;
  let removed = 0;
  for (const entry of readdirSync(koffiDir)) {
    if (entry !== keepTarget) {
      try { rmSync(join(koffiDir, entry), { recursive: true, force: true }); removed++; } catch { /* */ }
    }
  }
  return removed;
}

// ── Platform-specific: scoped native packages ────────────────────────────────

const PLATFORM_NATIVE_SCOPES = {
  '@napi-rs': /^canvas-(darwin|linux|win32)-(x64|arm64)/,
  '@img': /^sharp(?:-libvips)?-(darwin|linux|win32)-(x64|arm64)/,
  '@mariozechner': /^clipboard-(darwin|linux|win32)-(x64|arm64|universal)/,
};

function cleanupNativePlatformPackages(nodeModulesDir, platform, arch) {
  let removed = 0;
  for (const [scope, pattern] of Object.entries(PLATFORM_NATIVE_SCOPES)) {
    const scopeDir = join(nodeModulesDir, scope);
    if (!existsSync(scopeDir)) continue;
    for (const entry of readdirSync(scopeDir)) {
      const match = entry.match(pattern);
      if (!match) continue;
      const pkgPlatform = match[1];
      const pkgArch = match[2];
      const isMatch = pkgPlatform === platform && (pkgArch === arch || pkgArch === 'universal');
      if (!isMatch) {
        try { rmSync(join(scopeDir, entry), { recursive: true, force: true }); removed++; } catch { /* */ }
      }
    }
  }
  return removed;
}

// ── Broken module patcher ─────────────────────────────────────────────────────

const MODULE_PATCHES = {
  'node-domexception/index.js': [
    "'use strict';",
    'const dom = globalThis.DOMException ||',
    '  class DOMException extends Error {',
    "    constructor(msg, name) { super(msg); this.name = name || 'Error'; }",
    '  };',
    'module.exports = dom;',
    'module.exports.DOMException = dom;',
    'module.exports.default = dom;',
  ].join('\n') + '\n',
};

function patchBrokenModules(nodeModulesDir) {
  const { writeFileSync } = require('fs');
  let count = 0;
  for (const [rel, content] of Object.entries(MODULE_PATCHES)) {
    const target = join(nodeModulesDir, rel);
    if (existsSync(target)) {
      writeFileSync(target, content, 'utf8');
      count++;
    }
  }
  if (count > 0) {
    console.log(`[after-pack] Patched ${count} broken module(s)`);
  }
}

// ── Plugin bundler ───────────────────────────────────────────────────────────

function getVirtualStoreNodeModules(realPkgPath) {
  let dir = realPkgPath;
  while (dir !== dirname(dir)) {
    if (basename(dir) === 'node_modules') return dir;
    dir = dirname(dir);
  }
  return null;
}

function listPkgs(nodeModulesDir) {
  const result = [];
  const nDir = normWin(nodeModulesDir);
  if (!existsSync(nDir)) return result;
  for (const entry of readdirSync(nDir)) {
    if (entry === '.bin') continue;
    const fullPath = join(nodeModulesDir, entry);
    if (entry.startsWith('@')) {
      let subs;
      try { subs = readdirSync(normWin(fullPath)); } catch { continue; }
      for (const sub of subs) {
        result.push({ name: `${entry}/${sub}`, fullPath: join(fullPath, sub) });
      }
    } else {
      result.push({ name: entry, fullPath });
    }
  }
  return result;
}

function isInPnpmVirtualStore(realPath) {
  // pnpm virtual store paths contain /.pnpm/ or \.pnpm\
  return realPath.includes('.pnpm');
}

function readProdDeps(pkgDir) {
  try {
    const raw = require('fs').readFileSync(join(pkgDir, 'package.json'), 'utf8');
    return Object.keys(JSON.parse(raw).dependencies || {});
  } catch { return []; }
}

function bundlePlugin(nodeModulesRoot, npmName, destDir) {
  const pkgPath = join(nodeModulesRoot, ...npmName.split('/'));
  if (!existsSync(pkgPath)) {
    console.warn(`[after-pack] Plugin not found: ${pkgPath}`);
    return false;
  }

  let realPluginPath;
  try { realPluginPath = realpathSync(pkgPath); } catch { realPluginPath = pkgPath; }

  if (existsSync(normWin(destDir))) rmSync(normWin(destDir), { recursive: true, force: true });
  mkdirSync(normWin(destDir), { recursive: true });
  cpSync(normWin(realPluginPath), normWin(destDir), { recursive: true, dereference: true });

  // Collect transitive deps via pnpm virtual store BFS.
  // IMPORTANT: Only use BFS when the package is actually in the pnpm virtual
  // store (.pnpm/). If before-pack already copied it as a real directory,
  // the virtual store path resolves to the top-level node_modules, which
  // would cause us to walk ALL packages (thousands). In that case, fall back
  // to reading package.json dependencies and resolving them individually.
  const collected = new Map();

  const SKIP_PACKAGES = new Set(['typescript', '@playwright/test']);
  const SKIP_SCOPES = ['@types/'];
  try {
    const pluginPkg = JSON.parse(
      require('fs').readFileSync(join(destDir, 'package.json'), 'utf8')
    );
    for (const peer of Object.keys(pluginPkg.peerDependencies || {})) {
      SKIP_PACKAGES.add(peer);
    }
  } catch { /* ignore */ }

  if (isInPnpmVirtualStore(realPluginPath)) {
    // Normal pnpm path: BFS through virtual store siblings
    const queue = [];
    const rootVirtualNM = getVirtualStoreNodeModules(realPluginPath);
    if (rootVirtualNM) {
      queue.push({ nodeModulesDir: rootVirtualNM, skipPkg: npmName });
    }

    while (queue.length > 0) {
      const { nodeModulesDir, skipPkg } = queue.shift();
      for (const { name, fullPath } of listPkgs(nodeModulesDir)) {
        if (name === skipPkg) continue;
        if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some(s => name.startsWith(s))) continue;
        let rp;
        try { rp = realpathSync(fullPath); } catch { continue; }
        if (collected.has(rp)) continue;
        collected.set(rp, name);
        const depVirtualNM = getVirtualStoreNodeModules(rp);
        if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
          queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
        }
      }
    }
  } else {
    // Package is a real directory (before-pack copied it). Use package.json
    // dependency tree walk instead of virtual store BFS.
    console.log(`[after-pack]   ${npmName} is not in pnpm virtual store, using package.json dep walk`);
    const visited = new Set();
    const queue = [realPluginPath];
    while (queue.length > 0) {
      const pkgDir = queue.shift();
      for (const dep of readProdDeps(pkgDir)) {
        if (visited.has(dep)) continue;
        if (SKIP_PACKAGES.has(dep) || SKIP_SCOPES.some(s => dep.startsWith(s))) continue;
        visited.add(dep);
        const depPath = join(nodeModulesRoot, ...dep.split('/'));
        if (!existsSync(depPath)) continue;
        let rp;
        try { rp = realpathSync(depPath); } catch { continue; }
        collected.set(rp, dep);
        queue.push(rp);
      }
    }
  }

  // Copy flattened deps
  const destNM = join(destDir, 'node_modules');
  mkdirSync(destNM, { recursive: true });
  const copiedNames = new Set();
  let count = 0;
  for (const [rp, pkgName] of collected) {
    if (copiedNames.has(pkgName)) continue;
    copiedNames.add(pkgName);
    const d = join(destNM, pkgName);
    try {
      mkdirSync(normWin(dirname(d)), { recursive: true });
      cpSync(normWin(rp), normWin(d), { recursive: true, dereference: true });
      count++;
    } catch (e) {
      console.warn(`[after-pack]   Skipped dep ${pkgName}: ${e.message}`);
    }
  }
  console.log(`[after-pack] Plugin ${npmName}: copied ${count} deps`);
  return true;
}

// ── Critical modules that MUST be in the asar ────────────────────────────────

const CRITICAL_MODULES = [
  'ms', 'debug', 'builder-util-runtime', 'sax',
  'fs-extra', 'js-yaml', 'lazy-val', 'semver',
  'ws', 'electron-store', 'conf', 'atomically',
];

// ── Main hook ────────────────────────────────────────────────────────────────

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const platform = context.electronPlatformName;
  const arch = resolveArch(context.arch);

  console.log(`[after-pack] Target: ${platform}/${arch}, output: ${appOutDir}`);

  const src = join(__dirname, '..', 'build', 'openclaw', 'node_modules');
  let resourcesDir;
  if (platform === 'darwin') {
    const appName = context.packager.appInfo.productFilename;
    resourcesDir = join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  } else {
    resourcesDir = join(appOutDir, 'resources');
  }

  const openclawRoot = join(resourcesDir, 'openclaw');
  const dest = join(openclawRoot, 'node_modules');
  const nodeModulesRoot = join(__dirname, '..', 'node_modules');
  const pluginsDestRoot = join(resourcesDir, 'openclaw-plugins');

  if (!existsSync(src)) {
    console.warn('[after-pack] build/openclaw/node_modules not found. Run bundle-openclaw first.');
    return;
  }

  // 1. Copy openclaw node_modules (electron-builder skips due to .gitignore)
  const depCount = readdirSync(src, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '.bin').length;
  console.log(`[after-pack] Copying ${depCount} openclaw deps to ${dest} ...`);
  cpSync(src, dest, { recursive: true });
  console.log('[after-pack] openclaw node_modules copied.');
  patchBrokenModules(dest);

  // 2. Bundle plugins
  const BUNDLED_PLUGINS = [
    { npmName: '@soimy/dingtalk', pluginId: 'dingtalk' },
    { npmName: '@wecom/wecom-openclaw-plugin', pluginId: 'wecom' },
    { npmName: '@sliverp/qqbot', pluginId: 'qqbot' },
  ];
  mkdirSync(pluginsDestRoot, { recursive: true });
  for (const { npmName, pluginId } of BUNDLED_PLUGINS) {
    const pluginDestDir = join(pluginsDestRoot, pluginId);
    console.log(`[after-pack] Bundling plugin ${npmName} -> ${pluginId}`);
    const ok = bundlePlugin(nodeModulesRoot, npmName, pluginDestDir);
    if (ok) {
      const pluginNM = join(pluginDestDir, 'node_modules');
      cleanupUnnecessaryFiles(pluginDestDir);
      if (existsSync(pluginNM)) {
        cleanupKoffi(pluginNM, platform, arch);
        cleanupNativePlatformPackages(pluginNM, platform, arch);
      }
    }
  }

  // 3. General cleanup
  console.log('[after-pack] Cleaning up unnecessary files ...');
  const removedRoot = cleanupUnnecessaryFiles(openclawRoot);
  console.log(`[after-pack] Removed ${removedRoot} unnecessary files/directories.`);

  // 4. Platform-specific cleanup
  const koffiRemoved = cleanupKoffi(dest, platform, arch);
  if (koffiRemoved > 0) console.log(`[after-pack] koffi: removed ${koffiRemoved} non-target binaries.`);
  const nativeRemoved = cleanupNativePlatformPackages(dest, platform, arch);
  if (nativeRemoved > 0) console.log(`[after-pack] Removed ${nativeRemoved} non-target native packages.`);

  // 5. Verify critical deps exist in the app directory (no asar)
  const appDir = join(resourcesDir, 'app');
  if (existsSync(appDir)) {
    const appNM = join(appDir, 'node_modules');
    const missing = CRITICAL_MODULES.filter(m => !existsSync(join(appNM, ...m.split('/'))));
    if (missing.length > 0) {
      console.warn('[after-pack] WARNING: Missing modules in app dir: ' + missing.join(', '));
    } else {
      console.log('[after-pack] All critical modules present in app directory.');
    }
  }

  console.log('[after-pack] Done.');
};
