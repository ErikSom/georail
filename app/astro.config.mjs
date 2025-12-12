// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import obfuscator from 'vite-plugin-javascript-obfuscator';

const obfuscatorPlugin = obfuscator({
  options: {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.25,
    transformObjectKeys: true,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.1,
    debugProtection: true,
    disableConsoleOutput: true,
    domainLock: [
      'georail.app',
      '.georail.app',
      'georail-app.pages.dev',
      '.georail-app.pages.dev'
    ],
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: false,
    renameGlobals: true,
    selfDefending: true,
    simplify: true,
    splitStrings: false,
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 0.5,
    unicodeEscapeSequence: false
  },
  exclude: [/node_modules/, /vendor/]
});

// FORCE Apply ONLY to Client Build
// This prevents the obfuscator from breaking the SSG/Server build
obfuscatorPlugin.apply = (config, env) => {
  // Only run on 'build' command AND when NOT building for SSR (Server)
  return env.command === 'build' && !config.build?.ssr;
};

export default defineConfig({
  integrations: [preact()],
  vite: {
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('three')) return 'vendor-three';
              if (id.includes('supabase')) return 'vendor-supabase';
              return 'vendor';
            }
          }
        }
      }
    },
    plugins: [
      process.env.NODE_ENV === 'production' && obfuscatorPlugin
    ].filter(Boolean)
  }
});