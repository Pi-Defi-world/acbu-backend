describe("coverage threshold policy", () => {
  const jestConfig = require("../jest.config.js");

  it("enforces global minimum coverage thresholds", () => {
    expect(jestConfig.coverageThreshold).toBeDefined();
    expect(jestConfig.coverageThreshold.global).toEqual({
      statements: 45,
      branches: 35,
      functions: 45,
      lines: 45,
    });
  });

  it("keeps stricter thresholds for transfer service", () => {
    expect(jestConfig.coverageThreshold["./src/services/transfer/"]).toEqual({
      statements: 70,
      branches: 60,
      functions: 70,
      lines: 70,
    });
  });
});
