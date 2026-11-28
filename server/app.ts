import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AppConfig } from "./config";
import { createDatabase, type AccountRole, type DriverStatus, type RideKind, type TripRecord, type UserRecord } from "./db";
import { estimateRoute, ProviderError } from "./providers";
import { createPaymentProcessor } from "./payments";

type DatabaseService = ReturnType<typeof createDatabase>;
type AuthContext = {
  user: UserRecord;
  tokenHash: string;
  csrfHash: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  role: z.enum(["rider", "driver"]).default("rider"),
}).strict();

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();

const quoteSchema = z.object({
  pickup: z.string().trim().min(3).max(200),
  destination: z.string().trim().min(3).max(200),
  kind: z.enum(["Everyday", "Comfort", "XL"]),
}).strict();

const idempotencySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const topUpSchema = z.object({ amountCents: z.union([z.literal(2500), z.literal(5000)]) }).strict();
const onlineSchema = z.object({ online: z.boolean() }).strict();

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function createApp(
  config: AppConfig,
  db: DatabaseService = createDatabase(config.databasePath, config.demoMode),
) {
  const app = express();
  const paymentProcessor = createPaymentProcessor(config);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "32kb", strict: true }));
  app.use("/api", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }));
  const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many account attempts. Try again later." } },
  });

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", mode: config.demoMode ? "demo" : "live" });
  });

  app.get("/api/config", (_request, response) => {
    response.json({
      mode: config.demoMode ? "demo" : "live",
      maps: config.mapProvider === "mapbox" ? "mapbox" : "demo",
      payments: "demo",
      demoTopUps: config.demoMode,
      livePayments: false,
    });
  });

  app.post("/api/auth/register", authRateLimit, requireExpectedOrigin(config), asyncRoute(async (request, response) => {
    const input = parseBody(registerSchema, request.body);
    const existing = db.getUserByEmail(input.email);
    if (existing) throw new HttpError(409, "EMAIL_IN_USE", "An account with that email already exists.");
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = db.createUser({
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role,
      demoStartingBalanceCents: 25_000,
    });
    const session = issueSession(config, db, user.id);
    setSessionCookie(response, config, session.token);
    response.status(201).json({ user: publicUser(user), csrfToken: session.csrfToken });
  }));

  app.post("/api/auth/login", authRateLimit, requireExpectedOrigin(config), asyncRoute(async (request, response) => {
    const input = parseBody(loginSchema, request.body);
    const record = db.getUserByEmail(input.email);
    const passwordHash = record?.password_hash ?? "$2b$12$C6UzMDM.H6dfI/f/IKcEe.0gFqysHqvS6H8oFUxLwMoA6MlYcFnbK";
    const valid = await bcrypt.compare(input.password, passwordHash);
    if (!record || !valid) throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    const session = issueSession(config, db, record.id);
    setSessionCookie(response, config, session.token);
    response.json({ user: publicUser(record), csrfToken: session.csrfToken });
  }));

  app.post("/api/auth/logout", requireExpectedOrigin(config), requireSession(config, db), requireCsrf(config), (request, response) => {
    db.deleteSession(request.auth!.tokenHash);
    clearSessionCookie(response, config);
    response.status(204).end();
  });

  app.get("/api/auth/session", optionalSession(config, db), (request, response) => {
    if (!request.auth) {
      response.json({ user: null, csrfToken: null });
      return;
    }
    const csrfToken = randomBytes(32).toString("hex");
    const csrfHash = hash(config, csrfToken);
    db.updateSessionCsrfHash(request.auth.tokenHash, csrfHash);
    request.auth.csrfHash = csrfHash;
    response.json({ user: publicUser(request.auth.user), csrfToken });
  });

  app.post("/api/quotes", requireExpectedOrigin(config), requireSession(config, db), requireCsrf(config), requireRole("rider"), asyncRoute(async (request, response) => {
    const input = parseBody(quoteSchema, request.body);
    const { route, fareCents } = await estimateRoute(config, input);
    const quote = db.saveQuote({
      rider_id: request.auth!.user.id,
      pickup: input.pickup,
      destination: input.destination,
      kind: input.kind,
      fare_cents: fareCents,
      distance_meters: route.distanceMeters,
      duration_seconds: route.durationSeconds,
      provider: route.provider,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    response.status(201).json(presentQuote(quote));
  }));

  app.post("/api/trips", requireExpectedOrigin(config), requireSession(config, db), requireCsrf(config), requireRole("rider"), (request, response) => {
    const schema = z.object({ quoteId: z.string().uuid() }).strict();
    const input = parseBody(schema, request.body);
    const idempotencyKey = readIdempotencyKey(request);
    const quote = db.getQuoteForRider(input.quoteId, request.auth!.user.id);
    if (!quote) throw new HttpError(404, "QUOTE_EXPIRED", "This fare quote expired or is no longer available. Request a new quote.");
    const trip = db.requestTrip(request.auth!.user.id, quote, idempotencyKey);
    response.status(201).json(presentTrip(trip));
  });

  app.get("/api/trips", requireSession(config, db), (request, response) => {
    const user = request.auth!.user;
    response.json({ trips: db.getTrips(user.id, user.role).map(presentTrip) });
  });

  app.get("/api/trips/requests", requireSession(config, db), requireRole("driver"), (request, response) => {
    const driver = request.auth!.user;
    if (driver.driver_status !== "verified") throw new HttpError(403, "DRIVER_NOT_VERIFIED", "Driver verification is required before viewing trip requests.");
    if (driver.is_online !== 1) throw new HttpError(409, "DRIVER_OFFLINE", "Go online to view available requests.");
    response.json({ trips: db.getAvailableTrips().map(presentTrip) });
  });

  app.post("/api/trips/:id/accept", requireExpectedOrigin(config), requireSession(config, db), requireCsrf(config), requireRole("driver"), asyncRoute(async (request, response) => {
    const driver = request.auth!.user;
    if (driver.driver_status !== "verified" || driver.is_online !== 1) {
      throw new HttpError(403, "DRIVER_UNAVAILABLE", "Only a verified, online driver can accept a trip.");
    }
    const idempotencyKey = readIdempotencyKey(request);
    const trip = db.getTripById(readRouteId(request));
    if (!trip || trip.status !== "requested") throw new HttpError(404, "TRIP_UNAVAILABLE", "This trip is no longer available.");
    const payment = await paymentProcessor.captureAcceptedFare({
      tripId: trip.id,
      riderId: trip.rider_id,
      fareCents: trip.fare_cents,
      idempotencyKey: `${trip.id}:accept`,
    });
    const accepted = db.acceptTrip({
      tripId: trip.id,
      driverId: driver.id,
      idempotencyKey,
      paymentReference: payment.reference,
    });
    if (!accepted) throw new HttpError(409, "TRIP_ACCEPTANCE_FAILED", "The trip could not be accepted. It may have been taken by another driver or the rider wallet has insufficient demo funds.");
    response.json(presentTrip(accepted));
  }));

  app.post("/api/trips/:id/cancel", requireExpectedOrigin(config), requireSession(config, db), requireCsrf(config), asyncRoute(async (request, response) => {
    const idempotencyKey = readIdempotencyKey(request);
    const trip = db.getTripById(readRouteId(request));
    if (!trip) throw new HttpError(404, "TRIP_NOT_FOUND", "Trip not found.");
    const user = request.auth!.user;
    if (user.role === "rider" ? trip.rider_id !== user.id : trip.driver_id !== user.id) {
      throw new HttpError(404, "TRIP_NOT_FOUND", "Trip not found.");
    }
    if (trip.status !== "requested" && trip.status !== "accepted") {
      throw new HttpError(409, "TRIP_CANNOT_CANCEL", "This trip is already finished.");
    }
    if (trip.status === "accepted" && trip.driver_id) {
      await paymentProcessor.refundAcceptedFare({
        tripId: trip.id,
        fareCents: trip.fare_cents,
        idempotencyKey: `${trip.id}:refund`,
      });
    }
    const cancelled = db.cancelTrip({
      tripId: trip.id,
      userId: request.auth!.user.id,
      role: request.auth!.user.role,
      idempotencyKey,
    });
    if (!cancelled) throw new HttpError(409, "TRIP_CANNOT_CANCEL", "This trip cannot be cancelled by this account or is already finished.");
    response.json(presentTrip(cancelled));
  }));

  app.post("/api/trips/:id/complete", requireExpectedOrigin(config), requireSession(config, db), requireCsrf(config), requireRole("driver"), (request, response) => {
    const trip = db.completeTrip({
      tripId: readRouteId(request),
      driverId: request.auth!.user.id,
      idempotencyKey: readIdempotencyKey(request),
    });
    if (!trip) throw new HttpError(409, "TRIP_CANNOT_COMPLETE", "Only the assigned driver can complete an active trip.");
    response.json(presentTrip(trip));
  });

  app.patch("/api/driver/availability", requireExpectedOrigin(config), requireSession(config, db), requireCsrf(config), requireRole("driver"), (request, response) => {
    const { online } = parseBody(onlineSchema, request.body);
    const user = request.auth!.user;
    if (online && user.driver_status !== "verified") {
      throw new HttpError(403, "DRIVER_NOT_VERIFIED", "Driver verification is required before going online.");
    }
    const updated = db.setDriverOnline(user.id, online);
    response.json({ online: updated.is_online === 1, driverStatus: updated.driver_status });
  });

  app.get("/api/wallet", requireSession(config, db), (request, response) => {
    response.json(db.getWallet(request.auth!.user.id, request.auth!.user.role));
  });

  app.post("/api/wallet/demo-topups", requireExpectedOrigin(config), requireSession(config, db), requireCsrf(config), requireRole("rider"), (request, response) => {
    if (!config.demoMode) throw new HttpError(404, "NOT_FOUND", "Not found.");
    const { amountCents } = parseBody(topUpSchema, request.body);
    const applied = db.addDemoFunds(request.auth!.user.id, amountCents, readIdempotencyKey(request));
    if (!applied) throw new HttpError(409, "DUPLICATE_REQUEST", "This top-up request was already processed.");
    response.json(db.getWallet(request.auth!.user.id, "rider"));
  });

  app.post("/api/admin/drivers/:id/verification", requireExpectedOrigin(config), (request, response) => {
    if (!config.adminApiToken) throw new HttpError(404, "NOT_FOUND", "Not found.");
    const provided = request.header("x-admin-token") ?? "";
    if (!safeEqual(provided, config.adminApiToken)) throw new HttpError(401, "UNAUTHORIZED", "Valid operator credentials are required.");
    const schema = z.object({ approved: z.boolean() }).strict();
    const { approved } = parseBody(schema, request.body);
    const driver = db.verifyDriver(readRouteId(request), approved);
    if (!driver) throw new HttpError(404, "DRIVER_NOT_FOUND", "Driver account not found.");
    response.json({ driver: publicUser(driver) });
  });

  app.use("/api", (_request, _response, next) => next(new HttpError(404, "NOT_FOUND", "API route not found.")));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof ProviderError) {
      response.status(503).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
      return;
    }
    if (isSqliteConstraintError(error)) {
      response.status(409).json({ error: { code: "CONFLICT", message: "The request conflicts with current account or trip state." } });
      return;
    }
    if (error instanceof Error && error.message === "Insufficient wallet funds or wallet not found.") {
      response.status(409).json({ error: { code: "INSUFFICIENT_FUNDS", message: "The customer wallet cannot cover this fare." } });
      return;
    }
    console.error("Unhandled API error", error);
    response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } });
  });
  return app;
}

function requireExpectedOrigin(config: AppConfig) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (request.get("origin") !== config.appOrigin) {
      next(new HttpError(403, "ORIGIN_REJECTED", "Request origin is not allowed."));
      return;
    }
    next();
  };
}

function optionalSession(config: AppConfig, db: DatabaseService) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const token = readCookie(request, "uniondrive_session");
    if (!token) {
      next();
      return;
    }
    const tokenHash = hash(config, token);
    const record = db.getSession(tokenHash);
    if (!record) {
      next();
      return;
    }
    request.auth = { user: record, tokenHash, csrfHash: record.csrf_hash };
    next();
  };
}

function requireSession(config: AppConfig, db: DatabaseService) {
  return (request: Request, response: Response, next: NextFunction) => {
    optionalSession(config, db)(request, response, (error?: unknown) => {
      if (error) {
        next(error);
      } else if (!request.auth) {
        next(new HttpError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue."));
      } else {
        next();
      }
    });
  };
}

function requireCsrf(config: AppConfig) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const token = request.get("x-csrf-token") ?? "";
    if (!request.auth || !safeEqual(hash(config, token), request.auth.csrfHash)) {
      next(new HttpError(403, "CSRF_REJECTED", "Refresh your session before retrying this action."));
      return;
    }
    next();
  };
}

function requireRole(role: AccountRole) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (request.auth?.user.role !== role) {
      next(new HttpError(403, "ROLE_FORBIDDEN", "This account cannot perform that action."));
      return;
    }
    next();
  };
}

function issueSession(config: AppConfig, db: DatabaseService, userId: string) {
  const token = randomBytes(32).toString("hex");
  const csrfToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000).toISOString();
  db.createSession({ tokenHash: hash(config, token), userId, csrfHash: hash(config, csrfToken), expiresAt });
  return { token, csrfToken, expiresAt };
}

function setSessionCookie(response: Response, config: AppConfig, token: string) {
  const parts = [
    `uniondrive_session=${token}`,
    "Path=/",
    `Max-Age=${config.sessionTtlHours * 60 * 60}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (config.environment === "production") parts.push("Secure");
  response.append("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(response: Response, config: AppConfig) {
  const parts = ["uniondrive_session=", "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Strict"];
  if (config.environment === "production") parts.push("Secure");
  response.append("Set-Cookie", parts.join("; "));
}

function readCookie(request: Request, name: string) {
  const prefix = `${name}=`;
  return request.header("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
}

function readIdempotencyKey(request: Request) {
  const parsed = idempotencySchema.safeParse(request.get("idempotency-key"));
  if (!parsed.success) throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a unique idempotency key for this action.");
  return parsed.data;
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "INVALID_REQUEST", z.prettifyError(parsed.error));
  return parsed.data;
}

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

function hash(config: AppConfig, value: string) {
  return createHmac("sha256", config.sessionSecret).update(value).digest("hex");
}

function readRouteId(request: Request) {
  const parsed = z.string().uuid().safeParse(request.params.id);
  if (!parsed.success) throw new HttpError(400, "INVALID_ID", "The requested resource ID is invalid.");
  return parsed.data;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isSqliteConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string" && error.code.startsWith("SQLITE_CONSTRAINT");
}

function publicUser(user: {
  id: string;
  email: string;
  name: string;
  role: AccountRole;
  driverStatus: DriverStatus;
  isOnline: boolean;
  createdAt: string;
} | UserRecord) {
  if ("driver_status" in user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      driverStatus: user.driver_status,
      isOnline: user.is_online === 1,
      createdAt: user.created_at,
    };
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    driverStatus: user.driverStatus,
    isOnline: user.isOnline,
    createdAt: user.createdAt,
  };
}

function presentQuote(quote: {
  id: string;
  pickup: string;
  destination: string;
  kind: RideKind;
  fare_cents: number;
  distance_meters: number;
  duration_seconds: number;
  provider: string;
  expires_at: string;
}) {
  return {
    id: quote.id,
    pickup: quote.pickup,
    destination: quote.destination,
    kind: quote.kind,
    fareCents: quote.fare_cents,
    distanceMeters: quote.distance_meters,
    durationSeconds: quote.duration_seconds,
    provider: quote.provider,
    expiresAt: quote.expires_at,
  };
}

function presentTrip(trip: TripRecord) {
  return {
    id: trip.id,
    riderId: trip.rider_id,
    driverId: trip.driver_id,
    status: trip.status,
    paymentStatus: trip.payment_status,
    pickup: trip.pickup,
    destination: trip.destination,
    kind: trip.kind,
    fareCents: trip.fare_cents,
    driverPayoutCents: trip.driver_payout_cents,
    unionShareCents: trip.union_share_cents,
    distanceMeters: trip.distance_meters,
    durationSeconds: trip.duration_seconds,
    createdAt: trip.created_at,
    acceptedAt: trip.accepted_at,
    completedAt: trip.completed_at,
    cancelledAt: trip.cancelled_at,
  };
}
