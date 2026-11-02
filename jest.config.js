export default {
  transform: {},
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/worktrees/'],
  modulePathIgnorePatterns: ['/\\.claude/worktrees/'],
  verbose: true,
};