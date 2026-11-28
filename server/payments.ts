import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config";

export type AcceptedFarePayment = {
  reference: string;
  mode: "demo";
};

export interface PaymentProcessor {
  captureAcceptedFare(input: {
    tripId: string;
    riderId: string;
    fareCents: number;
    idempotencyKey: string;
  }): Promise<AcceptedFarePayment>;
  refundAcceptedFare(input: {
    tripId: string;
    fareCents: number;
    idempotencyKey: string;
  }): Promise<void>;
}

class DemoPaymentProcessor implements PaymentProcessor {
  async captureAcceptedFare(input: {
    tripId: string;
    riderId: string;
    fareCents: number;
    idempotencyKey: string;
  }) {
    if (input.fareCents <= 0 || !input.tripId || !input.riderId || !input.idempotencyKey) {
      throw new Error("Demo payment request is incomplete.");
    }
    return { reference: `demo_${randomUUID()}`, mode: "demo" as const };
  }

  async refundAcceptedFare(input: { tripId: string; fareCents: number; idempotencyKey: string }) {
    if (input.fareCents <= 0 || !input.tripId || !input.idempotencyKey) {
      throw new Error("Demo refund request is incomplete.");
    }
  }
}

export function createPaymentProcessor(config: AppConfig): PaymentProcessor {
  if (config.environment === "production" || !config.demoMode || config.paymentProvider !== "demo") {
    throw new Error("No live payment processor is implemented. Demo payments are available only in local demo mode.");
  }
  return new DemoPaymentProcessor();
}
