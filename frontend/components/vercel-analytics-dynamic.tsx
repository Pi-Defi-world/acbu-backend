"use client";

import dynamic from "next/dynamic";

const VercelAnalytics = dynamic(
  () =>
    import("@vercel/analytics/next").then((m) => ({ default: m.Analytics })),
  { ssr: false },
);

export default VercelAnalytics;
