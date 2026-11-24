import { getContractAddresses } from "../../config/contracts";
import { MintingService } from "./acbuMinting.service";
import { BurningService } from "./acbuBurning.service";
import { OracleService } from "./acbuOracle.service";
import { ReserveTrackerService } from "./acbuReserveTracker.service";
import { SavingsVaultService } from "./acbuSavingsVault.service";
import { LendingPoolService } from "./acbuLendingPool.service";
import { EscrowService } from "./acbuEscrow.service";

/**
 * Initialize contract services with deployed contract addresses (acbu_* naming)
 */
const contractAddresses = getContractAddresses();
export const acbuMintingService = new MintingService(contractAddresses.minting);
export const acbuBurningService = new BurningService(contractAddresses.burning);
export const acbuOracleService = new OracleService(contractAddresses.oracle);
export const acbuReserveTrackerService = new ReserveTrackerService(
  contractAddresses.reserveTracker,
);
export const acbuSavingsVaultService = new SavingsVaultService(
  contractAddresses.savingsVault || "",
);
export const acbuLendingPoolService = new LendingPoolService(contractAddresses.lendingPool || "");
export const acbuEscrowService = new EscrowService(contractAddresses.escrow || "");

export * from "./acbuMinting.service";
export * from "./acbuBurning.service";
export * from "./acbuOracle.service";
export * from "./acbuReserveTracker.service";
export * from "./acbuSavingsVault.service";
export {
  LendingPoolService,
  type DepositParams as LendingPoolDepositParams,
  type WithdrawParams as LendingPoolWithdrawParams,
  type BorrowParams as LendingPoolBorrowParams,
  type RepayParams as LendingPoolRepayParams,
  type LiquidateParams as LendingPoolLiquidateParams,
} from "./acbuLendingPool.service";
export * from "./acbuEscrow.service";
