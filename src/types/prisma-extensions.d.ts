import { PrismaClient as _PrismaClient } from "@prisma/client";

declare module "@prisma/client" {
  interface PrismaClient {
    bulkTransferJob: any;
  }
}
