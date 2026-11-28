import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
  DATABASE_PATH: z.string().min(1).default("./data/uniondrive.sqlite"),
  SESSION_SECRET: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  DEMO_MODE: z.enum(["true", "false"]).optional(),
  MAP_PROVIDER: z.enum(["demo", "mapbox"]).default("demo"),
  MAPBOX_ACCESS_TOKEN: z.string().optional(),
  ADMIN_API_TOKEN: z.string().optional(),
  PAYMENT_PROVIDER: z.enum(["demo", "stripe"]).default("demo"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
});

export type AppConfig = {
  environment: "development" | "test" | "production";
  port: number;
  appOrigin: string;
  databasePath: string;
  sessionSecret: string;
  sessionTtlHours: number;
  demoMode: boolean;
  mapProvider: "demo" | "mapbox";
  mapboxAccessToken?: string;
  adminApiToken?: string;
  paymentProvider: "demo" | "stripe";
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${z.prettifyError(parsed.error)}`);
  }
  const values = parsed.data;
  const isProduction = values.NODE_ENV === "production";
  const demoMode = values.DEMO_MODE === undefined ? !isProduction : values.DEMO_MODE === "true";
  const sessionSecret = values.SESSION_SECRET ?? (isProduction ? "" : "local-development-only-session-secret-change-before-deploy");

  if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  if (isProduction && demoMode) throw new Error("DEMO_MODE must be false in production.");
  if (isProduction && values.MAP_PROVIDER === "demo") throw new Error("Select a real MAP_PROVIDER before production.");
  if (values.MAP_PROVIDER === "mapbox" && !values.MAPBOX_ACCESS_TOKEN) {
    throw new Error("MAPBOX_ACCESS_TOKEN is required when MAP_PROVIDER=mapbox.");
  }
  if (values.PAYMENT_PROVIDER !== "demo") {
    throw new Error("The Stripe payment adapter is not implemented. Do not select it or accept real payments.");
  }
  if (isProduction) {
    throw new Error(
      "Production startup is disabled until a real payment processor, webhook verification, persistent production database, and deployment security policy are implemented.",
    );
  }

  return {
    environment: values.NODE_ENV,
    port: values.API_PORT,
    appOrigin: values.APP_ORIGIN,
    databasePath: values.DATABASE_PATH,
    sessionSecret,
    sessionTtlHours: values.SESSION_TTL_HOURS,
    demoMode,
    mapProvider: values.MAP_PROVIDER,
    mapboxAccessToken: values.MAPBOX_ACCESS_TOKEN,
    adminApiToken: values.ADMIN_API_TOKEN,
    paymentProvider: values.PAYMENT_PROVIDER,
  };
}
