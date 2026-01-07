// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import obfuscator from 'vite-plugin-javascript-obfuscator';

/** * Common settings shared between both instances.
 * @type {import('javascript-obfuscator').ObfuscatorOptions} 
 */
const baseOptions = {
  compact: true,
  controlFlowFlattening: true,
  deadCodeInjection: true,
  debugProtection: true,
  disableConsoleOutput: false,
  domainLock: ['georail.app', '.georail.app', 'localhost'],
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: false,
  renameGlobals: true,
  selfDefending: true,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayEncoding: ['rc4'],
  unicodeEscapeSequence: false
};

/**
 * Creates a configured Obfuscator plugin instance.
 * @param {boolean} isSecureMode - If true, applies "Nuclear" settings.
 * @returns {import('vite').Plugin}
 */
const createObfuscator = (isSecureMode) => {
  // @ts-ignore - The plugin types might not perfectly match the internal options structure, ignore strictly for the factory
  const plugin = obfuscator({
    include: isSecureMode ? [/\.secure/] : [],
    exclude: isSecureMode ? [] : [/\.secure/, /node_modules/, /vendor/],
    options: {
      ...baseOptions,

      // Dynamic Overrides
      ...(isSecureMode ? {
        controlFlowFlatteningThreshold: 1.0,
        deadCodeInjectionThreshold: 0.4,
        stringArrayThreshold: 1.0,
        transformObjectKeys: false,
        renameProperties: false,
      } : {
        controlFlowFlatteningThreshold: 0.25,
        deadCodeInjectionThreshold: 0.1,
        stringArrayThreshold: 0.5,
        transformObjectKeys: false,
        renameProperties: false
      })
    }
  });

  // Manually patch the apply function to prevent SSG breakage
  // @ts-ignore - We are overriding a readonly property or adding a new one, which is safe here but annoys TS
  plugin.apply = (config, env) => {
    return env.command === 'build' && !config.build?.ssr;
  };

  return plugin;
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
      process.env.NODE_ENV === 'production' && createObfuscator(true),
      process.env.NODE_ENV === 'production' && createObfuscator(false)
    ].filter(Boolean)
  }
});