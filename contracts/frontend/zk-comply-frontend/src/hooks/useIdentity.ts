import { useState, useEffect } from "react";
import { get } from "../lib/api";

export interface UserIdentity {
  kycLevel: number;
  countryCode: number;
  countryName: string;
  stellarAddress: string;
  isVerified: boolean;
}

const COUNTRY_MAP: Record<string, { code: number; name: string }> = {
  NG: { code: 566, name: "Nigeria" },
  KE: { code: 404, name: "Kenya" },
  ZA: { code: 710, name: "South Africa" },
  EG: { code: 818, name: "Egypt" },
  GH: { code: 288, name: "Ghana" },
  RW: { code: 646, name: "Rwanda" },
  SN: { code: 952, name: "Senegal (XOF)" },
  MA: { code: 504, name: "Morocco" },
  TZ: { code: 834, name: "Tanzania" },
  UG: { code: 800, name: "Uganda" },
};

function kycStatusToLevel(status: string): number {
  switch (status?.toLowerCase()) {
    case "enterprise":
      return 3;
    case "enhanced":
    case "verified":
      return 2;
    case "basic":
      return 1;
    default:
      return 0;
  }
}

function mapCountry(countryCode?: string): {
  code: number;
  name: string;
} {
  if (!countryCode) return { code: 0, name: "Unknown" };
  return COUNTRY_MAP[countryCode.toUpperCase()] || {
    code: parseInt(countryCode) || 0,
    name: countryCode,
  };
}

export function useIdentity(apiKey: string | null) {
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) {
      setLoading(false);
      setError("Not authenticated. Sign in to ACBU first.");
      return;
    }

    get<{
      kyc_status?: string;
      country_code?: string;
      stellar_address?: string;
    }>("/users/me", { apiKey })
      .then((user) => {
        const country = mapCountry(user.country_code);
        setIdentity({
          kycLevel: kycStatusToLevel(user.kyc_status || ""),
          countryCode: country.code,
          countryName: country.name,
          stellarAddress: user.stellar_address || "",
          isVerified: (user.kyc_status || "").toLowerCase() !== "unverified",
        });
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load identity");
        setLoading(false);
      });
  }, [apiKey]);

  return { identity, loading, error };
}
