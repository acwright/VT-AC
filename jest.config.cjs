module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: [
    'src/core/**/*.ts',
    'src/cli/**/*.ts',
    'src/main/**/*.ts',
    // Electron's own entry point — it is `app`/`BrowserWindow` wiring with no
    // seam a node-environment test could hold onto. Its services (serial,
    // settings, boot, cliShim) are covered.
    '!src/main/index.ts'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/renderer/src/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1'
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.core.json' }]
  }
}
