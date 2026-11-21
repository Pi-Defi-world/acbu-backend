/**
 * Wallet custody invariants (W10-SEC-006).
 *
 * Self-custody is a structural property, not a runtime flag: the backend must
 * be unable to generate, return, or recover a user's Stellar key. These checks
 * scan the shipped source so a future change cannot quietly reintroduce a
 * custodial path. See docs/WALLET_CUSTODY.md.
 */
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "..");
const sourceDirectory = path.join(repositoryRoot, "src");

function productionSources(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return productionSources(fullPath);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [fullPath] : [];
  });
}

const sources = productionSources(sourceDirectory).map((file) => ({
  relativePath: path.relative(repositoryRoot, file),
  content: fs.readFileSync(file, "utf8"),
}));

function violationsOf(pattern: RegExp): string[] {
  return sources.filter((source) => pattern.test(source.content)).map((source) => source.relativePath);
}

describe("wallet custody invariants", () => {
  it("covers the production sources that hold wallet logic", () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.map((source) => source.relativePath)).toContain(
      path.join("src", "services", "wallet", "walletService.ts"),
    );
  });

  it("never generates a user keypair server-side", () => {
    expect(violationsOf(/Keypair\.random\(\)/)).toEqual([]);
  });

  it("never encrypts a wallet secret with a key the backend can derive", () => {
    expect(violationsOf(/scryptSync/)).toEqual([]);
    expect(violationsOf(/acbu-wallet-v1/)).toEqual([]);
  });

  it("ships no path that returns a user's secret to a caller", () => {
    expect(violationsOf(/decryptUserStellarSecret/)).toEqual([]);
    // A `passphrase` field in a payload or schema, never the Stellar network
    // passphrase, which is public and legitimately named the same.
    expect(violationsOf(/(^|[^_A-Za-z])passphrase\s*[,:;]/)).toEqual([]);
  });

  it("keeps the removed custodial modules gone", () => {
    expect(fs.existsSync(path.join(sourceDirectory, "services", "wallet", "stellarSecretService.ts"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(sourceDirectory, "services", "stellar", "trustlineService.ts"))).toBe(
      false,
    );
    expect(violationsOf(/ensureWalletForUser|postWalletConfirm|walletConfirmSchema/)).toEqual([]);
  });

  it("signs no on-chain operation as a user", () => {
    const walletSources = sources.filter((source) =>
      source.relativePath.startsWith(path.join("src", "services", "wallet")),
    );
    const signing = walletSources.filter((source) => /\.sign\(|Keypair\.fromSecret\(/.test(source.content));
    expect(signing.map((source) => source.relativePath)).toEqual([]);
  });
});
