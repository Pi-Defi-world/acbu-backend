module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testTimeout: 30000,
  setupFiles: ["<rootDir>/tests/setup.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/jest.setup.ts"],
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
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
  coverageReporters: ["text", "lcov", "html"],
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
