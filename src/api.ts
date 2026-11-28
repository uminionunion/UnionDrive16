export type AccountRole = "rider" | "driver";
export type DriverStatus = "not_applicable" | "pending" | "verified" | "rejected";
export type TripStatus = "requested" | "accepted" | "cancelled" | "completed";
export type RideKind = "Everyday" | "Comfort" | "XL";

export type User = {
  id: string;
  email: string;
  name: string;
  role: AccountRole;
  driverStatus: DriverStatus;
  isOnline: boolean;
  createdAt: string;
};

export type RideQuote = {
  id: string;
  pickup: string;
  destination: string;
  kind: RideKind;
  fareCents: number;
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
  expiresAt: string;
};

export type Trip = {
  id: string;
  riderId: string;
  driverId: string | null;
  status: TripStatus;
  paymentStatus: "unpaid" | "paid" | "refunded";
  pickup: string;
  destination: string;
  kind: RideKind;
  fareCents: number;
  driverPayoutCents: number;
  unionShareCents: number;
  distanceMeters: number;
  durationSeconds: number;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
};

export type WalletTransaction = {
  id: string;
  wallet: "customer" | "driver" | "union";
  direction: "in" | "out";
  amountCents: number;
  description: string;
  rideId: string | null;
  createdAt: string;
};

export type WalletState = {
  balances: {
    customerCents?: number;
    driverCents?: number;
    unionCents: number;
  };
  transactions: WalletTransaction[];
};

export type AppConfig = {
  mode: "demo" | "live";
  maps: "demo" | "mapbox";
  payments: "demo";
  demoTopUps: boolean;
  livePayments: false;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers();
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  if (method !== "GET" && method !== "HEAD" && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_UNAVAILABLE", "The service could not be reached. Check the connection and try again.");
  }

  if (response.status === 204) return undefined as T;
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(response.status, "INVALID_RESPONSE", "The service returned an unexpected response.");
  }
  if (!response.ok) {
    const error = isRecord(result) && isRecord(result.error) ? result.error : {};
    throw new ApiError(
      response.status,
      typeof error.code === "string" ? error.code : "REQUEST_FAILED",
      typeof error.message === "string" ? error.message : "The request could not be completed.",
    );
  }
  return result as T;
}

export async function restoreSession() {
  const result = await apiRequest<{ user: User | null; csrfToken: string | null }>("/api/auth/session");
  setCsrfToken(result.csrfToken);
  return result.user;
}

export async function signIn(input: { email: string; password: string }) {
  const result = await apiRequest<{ user: User; csrfToken: string }>("/api/auth/login", { method: "POST", body: input });
  setCsrfToken(result.csrfToken);
  return result.user;
}

export async function signUp(input: { name: string; email: string; password: string; role: AccountRole }) {
  const result = await apiRequest<{ user: User; csrfToken: string }>("/api/auth/register", { method: "POST", body: input });
  setCsrfToken(result.csrfToken);
  return result.user;
}

export async function signOut() {
  await apiRequest<void>("/api/auth/logout", { method: "POST" });
  setCsrfToken(null);
}

export function newIdempotencyKey() {
  return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
