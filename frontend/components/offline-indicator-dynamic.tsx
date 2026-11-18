"use client";

import dynamic from "next/dynamic";

const OfflineIndicator = dynamic(
  () =>
    import("@/components/offline-indicator").then((m) => ({
      default: m.OfflineIndicator,
    })),
  { ssr: false },
);

export default OfflineIndicator;
