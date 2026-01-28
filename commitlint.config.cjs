module.exports = {
    extends: ['@commitlint/config-conventional'],
    rules: {
        // 0=off, 1=warn, 2=error
        'scope-enum': [2, 'always', [
            'map',      // Map Editor
            'train',    // Train Editor
            'game',     // The Game itself
            'core',     // Shared libraries
            'assets',   // Art, Audio, etc
            'meta'      // Config, builds, CI
        ]],
    },
    prompt: {
        messages: {
            type: "Select the type of change:",
            scope: "Select the SCOPE of this change (optional):",
            subject: "Write a short, imperative description of the change:",
            body: "Provide a longer description (optional). Use '|' to break new line:",
            confirmCommit: "Are you sure you want to proceed with the commit above?"
        },
        types: [
            { value: 'feat', name: 'feat:     ✨ A new feature' },
            { value: 'fix', name: 'fix:      🐛 A bug fix' },
            { value: 'perf', name: 'perf:     ⚡ Performance Improvements' },
            { value: 'docs', name: 'docs:     📚 Documentation only changes' },
            { value: 'style', name: 'style:    💎 Changes that do not affect the meaning of the code' },
            { value: 'refactor', name: 'refactor: ♻️ A code change that neither fixes a bug nor adds a feature' },
            { value: 'test', name: 'test:     ✅ Adding missing tests or correcting existing tests' },
            { value: 'chore', name: 'chore:    🤖 Other changes that don\'t modify src or test files' },
        ]
    }
};