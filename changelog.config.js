// changelog.config.js
module.exports = {
    writerOpts: {
        // 1. THIS IS THE NEW PART: Sort by Scope first, then by the message
        commitsSort: ['scope', 'subject'],

        transform: (commit, context) => {
            // Filter out Chores/Docs/Tests
            if (!commit.type || commit.type === 'chore' || commit.type === 'test') {
                return null;
            }

            const typeMap = {
                feat: 'Features',
                fix: 'Bug Fixes',
                perf: 'Performance',
                revert: 'Reverts'
            };
            commit.type = typeMap[commit.type] || commit.type;

            const scopeMap = {
                map: 'Map Editor',
                train: 'Train Editor',
                game: 'Game',
                core: 'Core',
                assets: 'Assets',
                meta: 'Config'
            };

            if (commit.scope) {
                commit.scope = scopeMap[commit.scope] || commit.scope;
            }

            return commit;
        }
    }
};