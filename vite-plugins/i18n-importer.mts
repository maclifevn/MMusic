import { readFileSync } from 'node:fs';
import { basename, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { Project } from 'ts-morph';

const __dirname = dirname(fileURLToPath(import.meta.url));
const globalProject = new Project({
  tsConfigFilePath: resolve(__dirname, '..', 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
  skipLoadingLibFiles: true,
  skipFileDependencyResolution: true,
});

export const i18nImporter = () => {
  const srcPath = resolve(__dirname, '..', 'src');
  const locales = globSync(['src/i18n/resources/*.json']).map((path) => {
    const nameWithExt = basename(path);
    const name = nameWithExt.replace(extname(nameWithExt), '');

    return { name, path };
  });

  const src = globalProject.createSourceFile(
    'vm:i18n',
    (writer) => {
      // Language metadata (name/local-name) extracted at build time so menus
      // can list every locale without importing all translation files.
      const languageList: Record<string, unknown> = {};
      for (const { name, path } of locales) {
        const absolutePath = resolve(srcPath, '..', path);
        const json = JSON.parse(readFileSync(absolutePath, 'utf-8')) as {
          language?: unknown;
        };
        languageList[name] = json.language ?? {};
      }
      writer.writeLine(
        `export const languageList = ${JSON.stringify(languageList)};`,
      );
      writer.blankLine();

      writer.writeLine('export const languageImporters = {');
      for (const { name, path } of locales) {
        const absolutePath = resolve(srcPath, '..', path).replace(/\\/g, '/');
        writer.writeLine(
          `  "${name}": () => import('${absolutePath}').then((mod) => mod.default),`,
        );
      }
      writer.writeLine('};');
      writer.blankLine();
    },
    { overwrite: true },
  );

  return src.getText();
};
