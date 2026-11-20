import { useState } from "react";
import { ComplianceForm } from "./components/ComplianceForm";

function App() {
  const [apiKey, setApiKey] = useState(
    () => sessionStorage.getItem("acbu_api_key") || ""
  );

  const saveKey = (key: string) => {
    setApiKey(key);
    if (key) sessionStorage.setItem("acbu_api_key", key);
    else sessionStorage.removeItem("acbu_api_key");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex items-center justify-between h-14 px-4 max-w-2xl mx-auto">
          <div>
            <h1 className="text-sm font-semibold leading-none">ZK-Comply</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Zero-knowledge compliance for ACBU
            </p>
          </div>
          {!apiKey && (
            <div className="flex items-center gap-2">
              <input
                type="password"
                placeholder="ACBU API key"
                value={apiKey}
                onChange={(e) => saveKey(e.target.value)}
                className="h-8 w-48 rounded-md border border-input bg-transparent px-2.5 py-1 text-xs shadow-xs"
              />
            </div>
          )}
        </div>
      </header>

      <main className="px-4 py-6 pb-24 max-w-2xl mx-auto space-y-6">
        {!apiKey ? (
          <div className="rounded-xl border bg-card text-card-foreground p-6 shadow-sm">
            <div className="flex flex-col items-center gap-4 text-center">
              <div>
                <h3 className="font-semibold">Enter your ACBU API Key</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Find it in your ACBU dashboard under Settings → API Keys.
                </p>
              </div>
              <input
                type="password"
                placeholder="ACBU API key"
                onChange={(e) => saveKey(e.target.value)}
                className="h-9 w-full max-w-sm rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              />
            </div>
          </div>
        ) : (
          <ComplianceForm apiKey={apiKey} />
        )}
      </main>
    </div>
  );
}

export default App;
