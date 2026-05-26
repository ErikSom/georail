import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';

const nodeGlobals = {
    AbortController: 'readonly',
    Buffer: 'readonly',
    clearInterval: 'readonly',
    clearTimeout: 'readonly',
    console: 'readonly',
    fetch: 'readonly',
    process: 'readonly',
    setInterval: 'readonly',
    setTimeout: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
};

export default [
    {
        ignores: ['node_modules/**'],
    },
    js.configs.recommended,
    prettierConfig,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: nodeGlobals,
        },
        rules: {
            semi: ['error', 'always'],
            'no-unused-vars': ['warn'],
        },
    },
];
