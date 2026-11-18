/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: [
    '<rootDir>/src/auth/__tests__/**/*.test.ts',
    '<rootDir>/server/__tests__/**/*.test.ts',
  ],
  transform: {
    '^.+\\.tsx?$': '<rootDir>/jest.esbuild-transform.mjs',
  },
};
