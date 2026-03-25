// src/controllers/mintController.ts
import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { MintService } from "../services/mint.service";
import { PriceService } from "../services/price.service"; // Add price service for conversions

@Controller("mint")
export class MintController {
  constructor(
    private readonly mintService: MintService,
    private readonly priceService: PriceService, // Inject price service
  ) {}

  @Post()
  async mint(@Body() mintDto: MintDto) {
    try {
      const { amount, currency, userId, limits } = mintDto;

      // Convert local currency amount to USD using real-time price
      const amountUsd = await this.convertToUsd(amount, currency);

      // Validate against USD limits
      this.validateLimits(amountUsd, limits);

      // Proceed with minting
      const result = await this.mintService.mint({
        userId,
        amount: amountUsd, // Store in USD
        currency,
        originalAmount: amount,
      });

      return {
        success: true,
        data: result,
        amountUsd,
      };
    } catch (error) {
      throw new HttpException(
        {
          message: "Mint failed",
          error: error.message,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async convertToUsd(
    amount: number,
    currency: string,
  ): Promise<number> {
    if (currency === "USD") {
      return amount;
    }

    try {
      // Fetch real-time price from oracle/API
      const priceUsd = await this.priceService.getPrice(currency, "USD");

      if (!priceUsd || priceUsd <= 0) {
        throw new Error(`Invalid price for ${currency}: ${priceUsd}`);
      }

      const amountUsd = amount * priceUsd;

      // Round to 6 decimals for precision
      return parseFloat(amountUsd.toFixed(6));
    } catch (error) {
      throw new Error(`Failed to convert ${currency} to USD: ${error.message}`);
    }
  }

  private validateLimits(amountUsd: number, limits: LimitConfig): void {
    const { dailyUsd = 1000, weeklyUsd = 5000, monthlyUsd = 20000 } = limits;

    // Check daily limit (implement your limit checking logic)
    const dailyUsed = this.getUserDailyUsage(amountUsd); // Implement this
    if (dailyUsed + amountUsd > dailyUsd) {
      throw new Error(`Daily USD limit exceeded: ${dailyUsd}`);
    }

    // Check weekly limit
    const weeklyUsed = this.getUserWeeklyUsage(amountUsd);
    if (weeklyUsed + amountUsd > weeklyUsd) {
      throw new Error(`Weekly USD limit exceeded: ${weeklyUsd}`);
    }

    // Check monthly limit
    const monthlyUsed = this.getUserMonthlyUsage(amountUsd);
    if (monthlyUsed + amountUsd > monthlyUsd) {
      throw new Error(`Monthly USD limit exceeded: ${monthlyUsd}`);
    }
  }

  // Placeholder methods - implement based on your storage solution
  private getUserDailyUsage(_amountUsd: number): number {
    // Fetch from Redis/DB: user's daily USD usage
    return 0; // Replace with real implementation
  }

  private getUserWeeklyUsage(_amountUsd: number): number {
    return 0; // Replace with real implementation
  }

  private getUserMonthlyUsage(_amountUsd: number): number {
    return 0; // Replace with real implementation
  }
}

// DTOs
export interface MintDto {
  amount: number;
  currency: string; // 'USD', 'ETH', 'USDC', etc.
  userId: string;
  limits?: LimitConfig;
}

export interface LimitConfig {
  dailyUsd?: number;
  weeklyUsd?: number;
  monthlyUsd?: number;
}
