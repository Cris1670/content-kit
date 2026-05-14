import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', 'node_modules']);
const javascriptExtensions = new Set(['.js', '.mjs']);

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const getExtension = (path) => {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index);
};

const collectJavaScriptFiles = (directory) => {
  const files = [];

  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (!ignoredDirectories.has(entry)) {
        files.push(...collectJavaScriptFiles(fullPath));
      }

      continue;
    }

    if (stats.isFile() && javascriptExtensions.has(getExtension(entry))) {
      files.push(fullPath);
    }
  }

  return files;
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const checkJavaScriptSyntax = () => {
  for (const file of collectJavaScriptFiles(root)) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`syntax ok: ${relative(root, file)}`);
  }
};

const checkPackage = () => {
  const packageJson = readJson(join(root, 'package.json'));

  assert(
    packageJson.name === 'content-kit',
    'package name must stay content-kit'
  );
  assert(
    packageJson.private === true,
    'package must stay private before public release'
  );
  assert(packageJson.license === 'MIT', 'package license must be MIT');
  assert(
    packageJson.engines?.node === '>=24',
    'package must require Node >=24'
  );
  assert(
    Array.isArray(packageJson.files),
    'package files allowlist is required'
  );
  assert(
    !packageJson.files.some((entry) => entry.includes('chrome-extension')),
    'npm package files must not include chrome-extension'
  );

  console.log('package metadata ok');
};

const checkExtensionManifest = () => {
  const manifest = readJson(join(root, 'chrome-extension/manifest.json'));
  const csp = manifest.content_security_policy?.extension_pages ?? '';

  assert(manifest.manifest_version === 3, 'extension must use Manifest V3');
  assert(manifest.version === '0.3.0', 'extension version must be 0.3.0');
  assert(
    Array.isArray(manifest.permissions) &&
      manifest.permissions.includes('storage') &&
      manifest.permissions.includes('activeTab'),
    'extension permissions must include storage and activeTab'
  );
  assert(
    csp.includes("default-src 'self'"),
    'extension CSP must default to self'
  );
  assert(
    csp.includes("script-src 'self'"),
    'extension CSP must only allow local scripts'
  );
  assert(
    csp.includes("connect-src 'none'"),
    'extension CSP must block network calls'
  );
  assert(!csp.includes('http:'), 'extension CSP must not allow http sources');
  assert(!csp.includes('https:'), 'extension CSP must not allow https sources');

  console.log('extension manifest ok');
};

try {
  checkJavaScriptSyntax();
  checkPackage();
  checkExtensionManifest();
  console.log('content-kit checks passed');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
