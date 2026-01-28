module.exports = {
    git: {
        commitMessage: 'chore(release): v${version}',
        tagName: 'v${version}',
        requireCleanWorkingDir: false
    },
    npm: {
        publish: false
    },
    plugins: {
        '@release-it/conventional-changelog': {
            preset: 'conventionalcommits',
            writerOpts: {
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

                    const scopeMap = {
                        map: 'Map Editor',
                        train: 'Train Editor',
                        game: 'Game',
                        core: 'Core',
                        assets: 'Assets',
                        meta: 'Config'
                    };

                    // Return a new object instead of mutating
                    return {
                        ...commit,
                        type: typeMap[commit.type] || commit.type,
                        scope: commit.scope ? (scopeMap[commit.scope] || commit.scope) : commit.scope
                    };
                }
            },
            infile: 'CHANGELOG.md',
            ignoreRecommendedBump: true,
            whatBump: false,
            context: {
                linkCompare: false,
                linkReferences: false
            }
        }
    }
};
