import { contractClient, ContractClient } from "../stellar/contractClient";
import { stellarClient } from "../stellar/client";

export interface CreateEscrowParams {
  payer: string; // Stellar address
  payee: string;
  amount: string; // Amount in smallest unit (7 decimals)
  escrowId: number;
}

export interface RefundEscrowParams {
  escrowId: number;
  payer: string;
}

export class EscrowService {
  private contractId: string;
  private contractClient: ContractClient;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.contractClient = contractClient;
  }

  async create(params: CreateEscrowParams): Promise<string> {
    const sourceAccount = stellarClient.getKeypair()?.publicKey();
    if (!sourceAccount) throw new Error("No source account available");

    const args = [
      ContractClient.toScVal(params.payer),
      ContractClient.toScVal(params.payee),
      ContractClient.toScVal(Number(params.amount)),
      ContractClient.toScVal(params.escrowId),
    ];
    const result = await this.contractClient.invokeContract({
      contractId: this.contractId,
      functionName: "create",
      args,
      sourceAccount,
    });
    return result.transactionHash;
  }

  async release(escrowId: number, payer: string): Promise<string> {
    const sourceAccount = stellarClient.getKeypair()?.publicKey();
    if (!sourceAccount) throw new Error("No source account available");

    const result = await this.contractClient.invokeContract({
      contractId: this.contractId,
      functionName: "release",
      args: [ContractClient.toScVal(escrowId), ContractClient.toScVal(payer)],
      sourceAccount,
    });
    return result.transactionHash;
  }

  async refund(params: RefundEscrowParams): Promise<string> {
    const sourceAccount = stellarClient.getKeypair()?.publicKey();
    if (!sourceAccount) throw new Error("No source account available");

    const result = await this.contractClient.invokeContract({
      contractId: this.contractId,
      functionName: "refund",
      args: [ContractClient.toScVal(params.escrowId), ContractClient.toScVal(params.payer)],
      sourceAccount,
    });
    return result.transactionHash;
  }

  async isPaused(): Promise<boolean> {
    const result = await this.contractClient.readContract(this.contractId, "is_paused", []);
    return ContractClient.fromScVal(result) as boolean;
  }
}
