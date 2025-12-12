// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import obfuscator from 'vite-plugin-javascript-obfuscator';

export default defineConfig({
  integrations: [preact()],
  vite: {
    plugins: [
      process.env.NODE_ENV === 'production' && obfuscator({
        options: {
          compact: true,
          controlFlowFlattening: true,
          controlFlowFlatteningThreshold: 0.25,
          numbersToExpressions: false,
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
          stringArray: true,
          stringArrayEncoding: ['rc4'],
          stringArrayThreshold: 0.5,
          splitStrings: false,
          transformObjectKeys: true,
          unicodeEscapeSequence: false
        },
        apply: 'build',
        exclude: [/node_modules/, /vendor/]
      })
    ].filter(Boolean)
  }
});