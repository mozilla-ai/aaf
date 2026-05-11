import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const browserActionsEntry = path.resolve(rootDir, '../packages/aaf-browser-actions/src/index.ts');
const outDir = path.resolve(rootDir, 'build');

export default defineConfig(({ mode }) => {
  const target = mode === 'content-script' ? 'content-script' : 'popup';
  return {
    resolve: {
      alias: {
        '@agent-accessibility-framework/browser-actions': browserActionsEntry,
      },
    },
    build: {
      outDir,
      emptyOutDir: target === 'popup',
      minify: false,
      sourcemap: false,
      lib: {
        entry: path.resolve(rootDir, `src/${target}.ts`),
        name: target === 'popup' ? 'AAFExtensionPopup' : 'AAFExtensionContentScript',
        formats: ['iife'],
        fileName: () => `${target}.js`,
      },
    },
  };
});
