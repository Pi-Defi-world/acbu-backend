/**
 * Structural tests for the Docker / docker-compose setup (W11-MIG-007).
 *
 * These tests guard the contract that CI and local workflows depend on:
 *  - the default compose profile starts the infrastructure services and the
 *    backend (as established on dev; CI targets services by name);
 *  - the optional services (frontend, stellar-sandbox) exist behind the
 *    documented profiles so the complete ACBU stack can be spun up with
 *    `docker compose --profile full up`.
 *
 * The compose file is intentionally validated with lightweight structural
 * checks (no YAML dependency) — the assertions target stable, top-level
 * service keys and their immediate attributes.
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const COMPOSE_PATH = path.join(ROOT, "docker-compose.yml");
const FRONTEND_DOCKERFILE_PATH = path.join(ROOT, "docker", "frontend.Dockerfile");
const BACKEND_DOCKERFILE_PATH = path.join(ROOT, "Dockerfile");

const composeFile = fs.readFileSync(COMPOSE_PATH, "utf8");

/** Extract the raw block of a top-level compose service definition. */
function serviceBlock(name: string): string {
  const pattern = new RegExp(`^  ${name}:\\n((?:    .*(?:\\n|$))+)`, "m");
  // Empty result makes downstream assertions fail with the service name in
  // the message, since the block would not contain the required attributes.
  return composeFile.match(pattern)?.[1] ?? "";
}

function hasProfiles(block: string, expected: string[]): boolean {
  const profilesMatch = block.match(/profiles:\s*\[([^\]]*)\]/);
  if (!profilesMatch) return false;
  const profiles = profilesMatch[1].split(",").map((p) => p.trim());
  return expected.every((p) => profiles.includes(p));
}

describe("docker-compose structure (W11-MIG-007)", () => {
  it("defines the infrastructure services with no profile (default up)", () => {
    for (const service of ["postgres", "mongodb", "rabbitmq"]) {
      const block = serviceBlock(service);
      // Infrastructure services must NOT be profile-gated: CI starts them
      // explicitly (`docker compose up -d --wait postgres mongodb rabbitmq`).
      expect(block).not.toMatch(/profiles:/);
      expect(block).toContain("healthcheck:");
    }
  });

  it("does not define a Redis service (reserved for future use)", () => {
    // .env.example documents Redis as not part of docker-compose; keep it out.
    expect(composeFile).not.toMatch(/^  redis:/m);
  });

  describe("application services", () => {
    it("defines a backend service wired to the compose infrastructure", () => {
      const block = serviceBlock("backend");
      expect(block).toContain("dockerfile: Dockerfile");
      // The backend container must wait for healthy infrastructure.
      expect(block).toContain("condition: service_healthy");
    });

    it("defines a frontend service behind the frontend/full profiles", () => {
      const block = serviceBlock("frontend");
      expect(hasProfiles(block, ["frontend", "full"])).toBe(true);
      // The frontend is built from the acbu-frontend directory via the
      // dedicated Dockerfile in docker/.
      expect(block).toContain("context: ./acbu-frontend");
      expect(block).toContain("dockerfile: ../docker/frontend.Dockerfile");
      expect(block).toContain('"3000:3000"');
    });

    it("defines a stellar-sandbox service behind the stellar/full profiles", () => {
      const block = serviceBlock("stellar-sandbox");
      expect(hasProfiles(block, ["stellar", "full"])).toBe(true);
      // Local (ephemeral) network mode via stellar/quickstart.
      expect(block).toContain("stellar/quickstart");
      expect(block).toContain("--local");
      expect(block).toContain('"8000:8000"');
    });
  });

  it("keeps the optional services out of the default profile", () => {
    // The optional services must declare at least one profile so that a
    // plain `docker compose up` (no flags) never attempts to build/start
    // them (the frontend build requires an acbu-frontend checkout).
    const optionalServices: Array<[string, string]> = [
      ["frontend", "frontend"],
      ["stellar-sandbox", "stellar"],
    ];
    for (const [service, profile] of optionalServices) {
      expect(hasProfiles(serviceBlock(service), [profile])).toBe(true);
    }
  });
});

describe("docker/frontend.Dockerfile (W11-MIG-007)", () => {
  it("exists and is a multi-stage build", () => {
    expect(fs.existsSync(FRONTEND_DOCKERFILE_PATH)).toBe(true);
    const content = fs.readFileSync(FRONTEND_DOCKERFILE_PATH, "utf8");
    const stages = (content.match(/^FROM /gm) || []).length;
    expect(stages).toBeGreaterThanOrEqual(3); // deps, builder, runner
  });

  it("uses pnpm and serves the Next.js standalone output", () => {
    const content = fs.readFileSync(FRONTEND_DOCKERFILE_PATH, "utf8");
    expect(content).toContain("pnpm");
    expect(content).toContain("next.config");
    expect(content).toContain(".next/standalone");
  });

  it("does not copy host secrets", () => {
    const content = fs.readFileSync(FRONTEND_DOCKERFILE_PATH, "utf8");
    expect(content).not.toMatch(/\.env(?!\.)/);
  });
});

describe("root Dockerfile (backend)", () => {
  it("remains a multi-stage backend build used by the backend service", () => {
    expect(fs.existsSync(BACKEND_DOCKERFILE_PATH)).toBe(true);
    const content = fs.readFileSync(BACKEND_DOCKERFILE_PATH, "utf8");
    const stages = (content.match(/^FROM /gm) || []).length;
    expect(stages).toBeGreaterThanOrEqual(2);
    expect(content).toContain("dist");
  });
});
