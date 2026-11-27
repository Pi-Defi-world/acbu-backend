'use client';

import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
} from '@creit.tech/stellar-wallets-kit';
import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';

// Create a singleton instance if we are in the browser
let swkInstance: StellarWalletsKit | null = null;

export function getStellarWalletsKit(): StellarWalletsKit {
  if (typeof window === 'undefined') {
    throw new Error('StellarWalletsKit can only be used in the browser');
  }

  if (!swkInstance) {
    const network =
      process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'MAINNET'
        ? WalletNetwork.MAINNET
        : WalletNetwork.TESTNET;

    swkInstance = new StellarWalletsKit({
      network,
      selectedWalletId: 'freighter',
      modules: allowAllModules(),
    });
  }

  return swkInstance;
}

export function useStellarWalletsKit() {
  const [kit, setKit] = useState<StellarWalletsKit | null>(null);

  useEffect(() => {
    try {
      setKit(getStellarWalletsKit());
    } catch (e) {
      logger.warn('Failed to initialize StellarWalletsKit', e);
    }
  }, []);

  return kit;
}
