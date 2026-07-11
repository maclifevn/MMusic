import { basename, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import {
  Node,
  Project,
  SyntaxKind,
  type Expression,
  type ObjectLiteralExpression,
  type SourceFile,
} from 'ts-morph';

// HACK: DO NOT USE @ ALIAS IN THIS FILE, IT WILL CAUSE PROBLEMS
import { Platform } from '../src/types/plugins';

const kebabToCamel = (text: string) =>
  text.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

const __dirname = dirname(fileURLToPath(import.meta.url));
const globalProject = new Project({
  tsConfigFilePath: resolve(__dirname, '..', 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
  skipLoadingLibFiles: true,
  skipFileDependencyResolution: true,
});

const srcRoot = resolve(__dirname, '..', 'src');

const getOrAddSourceFile = (absolutePath: string): SourceFile | undefined => {
  try {
    return (
      globalProject.getSourceFile(absolutePath) ??
      globalProject.addSourceFileAtPath(absolutePath)
    );
  } catch {
    return undefined;
  }
};

const unwrapExpression = (
  expr: Expression | undefined,
): Expression | undefined => {
  let current = expr;
  while (
    current &&
    (Node.isSatisfiesExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isParenthesizedExpression(current))
  ) {
    current = current.getExpression();
  }
  return current;
};

// Resolves an expression to an object literal, following local consts and one
// level of relative/`@/` named imports (e.g. `config: defaultConfig`).
const resolveObjectLiteral = (
  sourceFile: SourceFile,
  expr: Expression | undefined,
  depth = 0,
): ObjectLiteralExpression | undefined => {
  const expression = unwrapExpression(expr);
  if (!expression || depth > 3) return undefined;
  if (Node.isObjectLiteralExpression(expression)) return expression;
  if (!Node.isIdentifier(expression)) return undefined;

  const name = expression.getText();
  const localDecl = sourceFile.getVariableDeclaration(name);
  if (localDecl) {
    return resolveObjectLiteral(
      sourceFile,
      localDecl.getInitializer(),
      depth + 1,
    );
  }

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const namedImport = importDecl
      .getNamedImports()
      .find(
        (spec) => (spec.getAliasNode()?.getText() ?? spec.getName()) === name,
      );
    if (!namedImport) continue;

    const specifier = importDecl.getModuleSpecifierValue();
    const base = specifier.startsWith('@/')
      ? resolve(srcRoot, specifier.slice(2))
      : specifier.startsWith('.')
        ? resolve(dirname(sourceFile.getFilePath()), specifier)
        : undefined;
    if (!base) return undefined;

    for (const candidate of [
      `${base}.ts`,
      `${base}.tsx`,
      resolve(base, 'index.ts'),
    ]) {
      const depFile = getOrAddSourceFile(candidate);
      const decl = depFile?.getVariableDeclaration(namedImport.getName());
      if (decl) {
        return resolveObjectLiteral(depFile!, decl.getInitializer(), depth + 1);
      }
    }
    return undefined;
  }

  return undefined;
};

// Statically extracts the default `config.enabled` of a plugin so the main
// process can skip importing disabled plugins at startup. Returns null when
// the default cannot be determined at build time (runtime falls back to
// importing the module to decide).
const extractDefaultEnabled = (absolutePath: string): boolean | null => {
  try {
    const sourceFile = getOrAddSourceFile(absolutePath);
    if (!sourceFile) return null;

    const exportAssignment = sourceFile.getExportAssignment(
      (assignment) => !assignment.isExportEquals(),
    );
    const call = unwrapExpression(exportAssignment?.getExpression());
    if (!call || !Node.isCallExpression(call)) return null;

    const [firstArg] = call.getArguments();
    if (!firstArg || !Node.isExpression(firstArg)) return null;

    const pluginDef = resolveObjectLiteral(sourceFile, firstArg);
    const configProp = pluginDef?.getProperty('config');
    if (!configProp || !Node.isPropertyAssignment(configProp)) return null;

    const configObj = resolveObjectLiteral(
      sourceFile,
      configProp.getInitializer(),
    );
    const enabledProp = configObj?.getProperty('enabled');
    if (!enabledProp || !Node.isPropertyAssignment(enabledProp)) return null;

    const value = unwrapExpression(enabledProp.getInitializer());
    if (value?.getKind() === SyntaxKind.TrueKeyword) return true;
    if (value?.getKind() === SyntaxKind.FalseKeyword) return false;
    return null;
  } catch {
    return null;
  }
};

export const pluginVirtualModuleGenerator = (
  mode: 'main' | 'preload' | 'renderer',
) => {
  const srcPath = resolve(__dirname, '..', 'src');
  const plugins = globSync([
    'src/plugins/*/index.{js,ts,jsx,tsx}',
    'src/plugins/*.{js,ts,jsx,tsx}',
    '!src/plugins/utils/**/*',
    '!src/plugins/utils/*',
  ]).map((path) => {
    let name = basename(path);
    if (
      name === 'index.ts' ||
      name === 'index.js' ||
      name === 'index.jsx' ||
      name === 'index.tsx'
    ) {
      name = basename(resolve(path, '..'));
    }

    name = name.replace(extname(name), '');

    return { name, path };
  });

  const src = globalProject.createSourceFile(
    'vm:pluginIndexes',
    (writer) => {
      for (const { name, path } of plugins) {
        const absolutePath = resolve(srcPath, '..', path).replace(/\\/g, '/');
        if (mode === 'main') {
          // dynamic import (for main)
          writer.writeLine(
            `const ${kebabToCamel(name)}PluginImport = () => import('${absolutePath}');`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}Plugin = async () => (await ${kebabToCamel(name)}PluginImport()).default;`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}PluginStub = async () => (await ${kebabToCamel(name)}PluginImport()).pluginStub;`,
          );
        } else {
          // static import (preload does not support dynamic import)
          writer.writeLine(
            `import ${kebabToCamel(name)}PluginImport, { pluginStub as ${kebabToCamel(name)}PluginStubImport } from "${absolutePath}";`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}Plugin = () => Promise.resolve(${kebabToCamel(name)}PluginImport);`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}PluginStub = () => Promise.resolve(${kebabToCamel(name)}PluginStubImport);`,
          );
        }
      }

      writer.blankLine();
      if (mode === 'main' || mode === 'preload') {
        writer.writeLine("import is from 'electron-is';");
        writer.writeLine('globalThis.electronIs = is;');
      }
      writer.write(supportsPlatform.toString());
      writer.blankLine();
      writer.writeLine('export const supportsPluginPlatform = supportsPlatform;');
      writer.blankLine();

      if (mode === 'main') {
        // Per-plugin lazy importers + statically extracted default enabled
        // state, so startup only imports plugins that are actually enabled.
        writer.writeLine('export const mainPluginImporters = {');
        for (const { name } of plugins) {
          writer.writeLine(`  "${name}": ${kebabToCamel(name)}Plugin,`);
        }
        writer.writeLine('};');
        writer.blankLine();

        const defaultEnabled: Record<string, boolean | null> = {};
        for (const { name, path } of plugins) {
          defaultEnabled[name] = extractDefaultEnabled(
            resolve(srcPath, '..', path),
          );
        }
        writer.writeLine(
          `export const mainPluginDefaultEnabled = ${JSON.stringify(defaultEnabled)};`,
        );
        writer.blankLine();
      }

      // Context-specific exports
      writer.writeLine(`let ${mode}PluginsCache = null;`);
      writer.writeLine(`export const ${mode}Plugins = async () => {`);
      writer.writeLine(
        `  if (${mode}PluginsCache) return await ${mode}PluginsCache;`,
      );
      writer.writeLine(
        '  const { promise, resolve } = Promise.withResolvers();',
      );
      writer.writeLine('  ' + `${mode}PluginsCache = promise;`);
      writer.writeLine('  const pluginEntries = await Promise.all([');
      for (const { name } of plugins) {
        const checkMode = mode === 'main' ? 'backend' : mode;
        // HACK: To avoid situation like importing renderer plugins in main
        writer.writeLine(
          `    ${kebabToCamel(name)}Plugin().then((plg) => plg['${checkMode}'] ? ["${name}", plg] : null),`,
        );
      }
      writer.writeLine('  ]);');
      writer.writeLine(
        '  resolve(pluginEntries.filter((entry) => entry && supportsPlatform(entry[1])).reduce((acc, [name, plg]) => { acc[name] = plg; return acc; }, {}));',
      );
      writer.writeLine(`  return await ${mode}PluginsCache;`);
      writer.writeLine('};');
      writer.blankLine();

      // All plugins export (stub only) // Omit<Plugin, 'backend' | 'preload' | 'renderer'>
      writer.writeLine('let allPluginsCache = null;');
      writer.writeLine('export const allPlugins = async () => {');
      writer.writeLine('  if (allPluginsCache) return await allPluginsCache;');
      writer.writeLine(
        '  const { promise, resolve } = Promise.withResolvers();',
      );
      writer.writeLine('  allPluginsCache = promise;');
      writer.writeLine('  const stubEntries = await Promise.all([');
      for (const { name } of plugins) {
        writer.writeLine(
          `    ${kebabToCamel(name)}PluginStub().then((stub) => ["${name}", stub]),`,
        );
      }
      writer.writeLine('  ]);');
      writer.writeLine(
        '  resolve(stubEntries.filter(entry => entry && supportsPlatform(entry[1])).reduce((acc, [name, plg]) => { acc[name] = plg; return acc; }, {}));',
      );
      writer.writeLine('  return await promise;');
      writer.writeLine('};');
      writer.blankLine();
    },
    { overwrite: true },
  );

  return src.getText();
};

function supportsPlatform({ platform }: { platform: string }) {
  if (typeof platform !== 'number') return true;

  const is = (globalThis as typeof globalThis & {
    electronIs: typeof import('electron-is');
  }).electronIs;

  if (is.windows()) return (platform & Platform.Windows) !== 0;
  if (is.macOS()) return (platform & Platform.macOS) !== 0;
  if (is.linux()) return (platform & Platform.Linux) !== 0;
  if (is.freebsd()) return (platform & Platform.Freebsd) !== 0;

  // unknown platform
  return false;
}
