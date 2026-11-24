import { contractClient, ContractClient } from "../stellar/contractClient";
import { stellarClient } from "../stellar/client";

export interface DepositParams {
  user: string; // Stellar address
  amount: string; // Amount in smallest unit (7 decimals)
  termSeconds: number;
}

export interface WithdrawParams {
  user: string;
  termSeconds: number;
  amount: string;
}

export class SavingsVaultService {
  private contractId: string;
  private contractClient: ContractClient;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.contractClient = contractClient;
  }

  async deposit(params: DepositParams): Promise<{ transactionHash: string; newBalance: string }> {
    const sourceAccount = stellarClient.getKeypair()?.publicKey();
    if (!sourceAccount) throw new Error("No source account available");

    const args = [
      ContractClient.toScVal(params.user),
      ContractClient.toScVal(Number(params.amount)),
      ContractClient.toScVal(params.termSeconds),
    ];
    const result = await this.contractClient.invokeContract({
      contractId: this.contractId,
      functionName: "deposit",
      args,
      sourceAccount,
    });
    const newBalance = ContractClient.fromScVal(result.result);
    return {
      transactionHash: result.transactionHash,
      newBalance: newBalance.toString(),
    };
  }

  async withdraw(params: WithdrawParams): Promise<string> {
    const sourceAccount = stellarClient.getKeypair()?.publicKey();
    if (!sourceAccount) throw new Error("No source account available");

    const args = [
      ContractClient.toScVal(params.user),
      ContractClient.toScVal(params.termSeconds),
      ContractClient.toScVal(Number(params.amount)),
    ];
    const result = await this.contractClient.invokeContract({
      contractId: this.contractId,
      functionName: "withdraw",
      args,
      sourceAccount,
    });
    return result.transactionHash;
  }

  async getBalance(user: string, termSeconds: number): Promise<string> {
    const result = await this.contractClient.readContract(this.contractId, "get_balance", [
      ContractClient.toScVal(user),
      ContractClient.toScVal(termSeconds),
    ]);
    const balance = ContractClient.fromScVal(result);
    return balance.toString();
  }

  async isPaused(): Promise<boolean> {
    const result = await this.contractClient.readContract(this.contractId, "is_paused", []);
    return ContractClient.fromScVal(result) as boolean;
  }
}
