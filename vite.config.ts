import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Two editions build from this project:
 * - the full Co-op Command (simulation, campaigns, sprite battlefield), with the tabletop edition inside it;
 * - the tabletop edition alone (`vite build --mode tabletop`), the one published: its own entry, and of public/ only
 *   the files it uses — no StarCraft art, audio or campaign media.
 * Where the full app's entry does not exist (the published tabletop branch), the tabletop edition is all there is.
 */
const TABLETOP_PUBLIC = ['dice', 'terrain-ref', 'icons', 'models', 'cards'];

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

/** The tabletop edition's page and its public files, copied into the build as part of the bundle. */
function tabletopEdition(): Plugin {
  return {
    name: 'tabletop-edition',
    // First, before Vite resolves the page's script.
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('/src/main.tsx', '/src/tabletop/main.tsx').replace(/<title>.*<\/title>/, '<title>Co-op Command · Tabletop</title>'),
    },
    generateBundle() {
      for (const top of TABLETOP_PUBLIC) {
        for (const file of filesUnder(path.resolve('public', top))) {
          this.emitFile({ type: 'asset', fileName: path.relative(path.resolve('public'), file).split(path.sep).join('/'), source: readFileSync(file) });
        }
      }
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const tabletop = mode === 'tabletop' || !existsSync(path.resolve('src/main.tsx'));
  const src = (p: string) => path.resolve(process.cwd(), 'src', p);
  return {
    base: './',
    // The tabletop build copies only its own public files (see tabletopEdition); in dev everything is served.
    publicDir: tabletop && command === 'build' ? false : 'public',
    plugins: [
      react(),
      ...(tabletop ? [tabletopEdition()] : []),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon.svg'],
        manifest: {
          name: tabletop ? 'Co-op Command · Tabletop' : 'SC TMG Co-op Command',
          short_name: tabletop ? 'Co-op Tabletop' : 'SC Co-op',
          description: 'A fan-developed companion app for StarCraft TMG: new co-op missions inspired by SC2, against enemy forces piloted by the app',
          theme_color: '#050a14',
          background_color: '#050a14',
          display: 'standalone',
          orientation: 'any',
          icons: [{ src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
        },
        // The campaign's voices and video are optional local media: they are not part of the offline bundle.
        workbox: tabletop
          ? { globPatterns: ['**/*.{js,css,html,svg,png,webp,json,webmanifest}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 }
          : { globPatterns: ['**/*.{js,css,html,svg,json,webmanifest}'], globIgnores: ['**/campaign/**'] },
      }),
    ],
    resolve: {
      alias: [
        { find: '@engine', replacement: src('engine') },
        { find: '@data', replacement: src('data') },
        // In the tabletop edition alone, its own screens and stores are the app's. Inside the full app the
        // edition's screens run on the full app's stores (one game, one settings), which carry more.
        { find: '@ui', replacement: tabletop ? src('tabletop/ui') : src('ui') },
        { find: '@store', replacement: tabletop ? src('tabletop/store') : src('store') },
        { find: /^@tt\/store\//, replacement: `${tabletop ? src('tabletop/store') : src('store')}/` },
        { find: '@tt', replacement: src('tabletop') },
      ],
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
