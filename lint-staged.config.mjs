// Fast first filter on commit; the full gate is in CONTRIBUTING.md. ESLint resolves the config
// from each file's directory, so a staged file is linted with its own workspace's rules.
const CONTEXT_FILES = '{.context/docs/README.md,AGENTS.md,.claude/CLAUDE.md,.github/copilot-instructions.md}';

export default {
  '*.{ts,tsx,js,mjs,cjs}': 'eslint --flag v10_config_lookup_from_file --max-warnings 0',
  // The check reads the files from disk, so it takes no file arguments.
  [CONTEXT_FILES]: () => 'npm run check:context',
};
