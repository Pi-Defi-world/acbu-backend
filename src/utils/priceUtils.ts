import { config } from "../config/env";
import { OracleService } from "../services/contracts/acbuOracle.service";

export async function getAcbuUsdRate(): Promise<string> {
  if (!config.contracts.oracle) return "1";
  return new OracleService(config.contracts.oracle).getAcbuUsdRate();
}
