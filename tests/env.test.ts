describe("env validation", () => {
  const ORIGINAL = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL };
  });

  afterAll(() => {
    process.env = ORIGINAL;
  });

  it("throws when JWT_SECRET is missing", () => {
    delete process.env.JWT_SECRET;
    expect(() => require("../src/config/env")).toThrow(/JWT_SECRET/);
  });

  it("throws when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    expect(() => require("../src/config/env")).toThrow(/DATABASE_URL/);
  });

  it("throws when MONGODB_URI is missing", () => {
    delete process.env.MONGODB_URI;
    expect(() => require("../src/config/env")).toThrow(/MONGODB_URI/);
  });

  it("loads successfully with all required vars set", () => {
    expect(() => require("../src/config/env")).not.toThrow();
  });

  it("coerces PORT to a number", () => {
    process.env.PORT = "3000";
    const { config } = require("../src/config/env");
    expect(typeof config.port).toBe("number");
    expect(config.port).toBe(3000);
  });
});
