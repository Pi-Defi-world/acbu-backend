module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testTimeout: 30000,
  setupFiles: ["<rootDir>/tests/setup.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/jest.setup.ts"],
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  // W11-MIG-008: the monorepo also carries frontend (Next.js/vitest) and
  // contracts (Rust) trees. Their tests are not part of the backend run and
  // would crash the root suite if Jest ever scans them via a widened root or
  // an explicit path argument, so exclude them defensively.
  testPathIgnorePatterns: ["/node_modules/", "/frontend/", "/contracts/"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { diagnostics: false }],
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.test.ts",
    "!src/index.ts",
  ],
  coverageDirectory: "coverage",
  // "json-summary" emits coverage/coverage-summary.json, a small machine-readable
  // totals file the CI workflow reads to post a coverage table into the run's
  // job summary — otherwise coverage is only visible by downloading the
  // uploaded artifact, so reviewers have no in-PR regression signal.
  coverageReporters: ["text", "lcov", "html", "json-summary"],
  coverageThreshold: {
    global: {
      statements: 45,
      branches: 35,
      functions: 45,
      lines: 45,
    },
    "./src/services/transfer/": {
      statements: 70,
      branches: 60,
      functions: 70,
      lines: 70,
    },
    "./src/services/webhook/": {
      statements: 70,
      branches: 60,
      functions: 70,
      lines: 70,
    },
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
