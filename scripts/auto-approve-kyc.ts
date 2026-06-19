/**
 * Auto-approve all pending KYC applications.
 * 
 * Every KYC'd user is automatically a validator. This script:
 * 1. Finds all applications in "peer_review" status
 * 2. Auto-registers a validator for each country if needed
 * 3. Submits an "approved" validation for each application
 * 
 * Usage: npx ts-node --transpile-only scripts/auto-approve-kyc.ts
 */

const API = "http://localhost:5000/api/v1";

// Demo credentials — replace with real ones
const TOKEN = "acbu_b32845b0b8d3_3d8106c98a0e390a9654d0952acca428b310aa1727329ede415b373cf510c731";

async function api(path: string, method = "GET", body?: unknown) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
    "x-api-key": TOKEN,
  };
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  console.log("Auto-approving KYC applications...\n");

  // 1) Get all applications
  const { applications } = await api("/kyc/applications") as any;

  if (!applications || applications.length === 0) {
    console.log("No KYC applications found.");
    return;
  }

  const pending = applications.filter(
    (a: any) => a.status === "peer_review"
  );

  console.log(`Found ${pending.length} application(s) in peer_review.\n`);

  for (const app of pending) {
    console.log(`Processing application ${app.id} (${app.countryCode})...`);

    // 2) Auto-create validator (if not exists — handled by backend)
    // 3) Submit approval
    try {
      await api(`/kyc/validator/tasks/${app.id}`, "POST", {
        result: "approved",
        notes: "Auto-approved — infrastructure bootstrap",
      });
      console.log(`  ✅ Approved`);
    } catch (e: any) {
      if (e.message.includes("already validated")) {
        console.log(`  ⏭️ Already validated`);
      } else if (e.message.includes("403")) {
        console.log(`  ❌ Not a validator — complete KYC first`);
      } else {
        console.log(`  ❌ ${e.message}`);
      }
    }
  }

  console.log("\nDone. All pending applications processed.");
}

main().catch(console.error);
