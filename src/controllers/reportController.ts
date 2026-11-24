import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { getMonthlyStatements } from "../services/reports/reportService";

type StatementRow = {
  id: string;
  type: string;
  status: string;
  acbuAmount: string | null;
  acbuAmountBurned: string | null;
  usdcAmount: string | null;
  localCurrency: string | null;
  localAmount: string | null;
  fee: string | null;
  createdAt: string;
  completedAt: string | null;
};

function sanitizeCsvValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  const stringValue = String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function formatStatementsAsCsv(statements: StatementRow[]): string {
  const header = [
    "transaction_id",
    "type",
    "status",
    "acbu_amount",
    "acbu_amount_burned",
    "usdc_amount",
    "local_currency",
    "local_amount",
    "fee",
    "created_at",
    "completed_at",
  ];

  const rows = statements.map((statement) => [
    statement.id,
    statement.type,
    statement.status,
    statement.acbuAmount,
    statement.acbuAmountBurned,
    statement.usdcAmount,
    statement.localCurrency,
    statement.localAmount,
    statement.fee,
    statement.createdAt,
    statement.completedAt,
  ]);

  return [header, ...rows].map((row) => row.map(sanitizeCsvValue).join(",")).join("\r\n");
}

function getStatementFilename(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `acbu_statement_${year}-${month}.csv`;
}

export async function exportTransactionReport(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      throw new AppError("User-scoped API key required", 401, "UNAUTHORIZED");
    }

    const rawLimit = req.query.limit;
    let limit = 20;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isNaN(parsed) && parsed > 0) {
        limit = Math.min(100, Math.max(1, Math.floor(parsed)));
      }
    }

    const format = String(req.query.format || "json").toLowerCase();
    if (!["json", "csv"].includes(format)) {
      throw new AppError(
        `Unsupported format '${format}'. Supported formats are csv and json.`,
        400,
        "INVALID_FORMAT",
      );
    }

    const transactions = (await getMonthlyStatements(
      {
        userId,
        type: { in: ["mint", "burn", "transfer"] },
      },
      limit,
    )) as Array<{
      id: string;
      type: string;
      status: string;
      acbuAmount: { toString(): string } | null;
      acbuAmountBurned: { toString(): string } | null;
      usdcAmount: { toString(): string } | null;
      localCurrency: string | null;
      localAmount: { toString(): string } | null;
      fee: { toString(): string } | null;
      createdAt: Date;
      completedAt: Date | null;
    }>;

    if (format === "csv") {
      const csv = formatStatementsAsCsv(
        transactions.map((transaction) => ({
          id: transaction.id,
          type: transaction.type,
          status: transaction.status,
          acbuAmount: transaction.acbuAmount?.toString() ?? null,
          acbuAmountBurned: transaction.acbuAmountBurned?.toString() ?? null,
          usdcAmount: transaction.usdcAmount?.toString() ?? null,
          localCurrency: transaction.localCurrency ?? null,
          localAmount: transaction.localAmount?.toString() ?? null,
          fee: transaction.fee?.toString() ?? null,
          createdAt: transaction.createdAt.toISOString(),
          completedAt: transaction.completedAt?.toISOString() ?? null,
        })),
      );

      const filename = getStatementFilename();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(csv);
      return;
    }

    res.status(200).json({ statements: transactions, limit });
  } catch (e) {
    next(e);
  }
}
