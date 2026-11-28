import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type AccountRole = "rider" | "driver";
export type DriverStatus = "not_applicable" | "pending" | "verified" | "rejected";
export type TripStatus = "requested" | "accepted" | "cancelled" | "completed";
export type PaymentStatus = "unpaid" | "paid" | "refunded";
export type RideKind = "Everyday" | "Comfort" | "XL";

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  role: AccountRole;
  driver_status: DriverStatus;
  is_online: number;
  created_at: string;
};

export type QuoteRecord = {
  id: string;
  rider_id: string;
  pickup: string;
  destination: string;
  kind: RideKind;
  fare_cents: number;
  distance_meters: number;
  duration_seconds: number;
  provider: string;
  expires_at: string;
  created_at: string;
};

export type TripRecord = {
  id: string;
  rider_id: string;
  driver_id: string | null;
  quote_id: string;
  status: TripStatus;
  payment_status: PaymentStatus;
  payment_reference: string | null;
  pickup: string;
  destination: string;
  kind: RideKind;
  fare_cents: number;
  driver_payout_cents: number;
  union_share_cents: number;
  distance_meters: number;
  duration_seconds: number;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

const schema = `
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('rider', 'driver')),
    driver_status TEXT NOT NULL CHECK (driver_status IN ('not_applicable', 'pending', 'verified', 'rejected')),
    is_online INTEGER NOT NULL DEFAULT 0 CHECK (is_online IN (0, 1)),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('customer', 'driver', 'union')),
    balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    created_at TEXT NOT NULL,
    UNIQUE(owner_id, kind)
  );
  INSERT OR IGNORE INTO wallets (id, owner_id, kind, balance_cents, created_at)
  VALUES ('union', NULL, 'union', 0, datetime('now'));

  CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    rider_id TEXT NOT NULL REFERENCES users(id),
    pickup TEXT NOT NULL,
    destination TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('Everyday', 'Comfort', 'XL')),
    fare_cents INTEGER NOT NULL CHECK (fare_cents > 0),
    distance_meters INTEGER NOT NULL CHECK (distance_meters > 0),
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
    provider TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS quotes_rider_idx ON quotes(rider_id, created_at);

  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    rider_id TEXT NOT NULL REFERENCES users(id),
    driver_id TEXT REFERENCES users(id),
    quote_id TEXT NOT NULL UNIQUE REFERENCES quotes(id),
    status TEXT NOT NULL CHECK (status IN ('requested', 'accepted', 'cancelled', 'completed')),
    payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
    payment_reference TEXT UNIQUE,
    pickup TEXT NOT NULL,
    destination TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('Everyday', 'Comfort', 'XL')),
    fare_cents INTEGER NOT NULL CHECK (fare_cents > 0),
    driver_payout_cents INTEGER NOT NULL CHECK (driver_payout_cents >= 0),
    union_share_cents INTEGER NOT NULL CHECK (union_share_cents >= 0),
    distance_meters INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    accepted_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT
  );
  CREATE INDEX IF NOT EXISTS trips_rider_idx ON trips(rider_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS trips_driver_idx ON trips(driver_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS trips_dispatch_idx ON trips(status, created_at);

  CREATE TABLE IF NOT EXISTS ledger_operations (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL,
    actor_id TEXT NOT NULL REFERENCES users(id),
    trip_id TEXT REFERENCES trips(id),
    operation TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(actor_id, idempotency_key)
  );

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES ledger_operations(id),
    wallet_id TEXT NOT NULL REFERENCES wallets(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents != 0),
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ledger_wallet_idx ON ledger_entries(wallet_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS ledger_operation_idx ON ledger_entries(operation_id);
`;

function publicUser(record: UserRecord) {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    role: record.role,
    driverStatus: record.driver_status,
    isOnline: record.is_online === 1,
    createdAt: record.created_at,
  };
}

export function createDatabase(databasePath: string, demoMode: boolean) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.exec(schema);

  return {
    close: () => {
      db.close();
    },
    createUser(input: {
      email: string;
      name: string;
      passwordHash: string;
      role: AccountRole;
      demoStartingBalanceCents: number;
    }) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const transaction = db.transaction(() => {
        db.prepare(
          "INSERT INTO users (id, email, name, password_hash, role, driver_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(id, input.email, input.name, input.passwordHash, input.role, input.role === "driver" ? "pending" : "not_applicable", now);
        const walletId = `${id}:${input.role === "driver" ? "driver" : "customer"}`;
        db.prepare("INSERT INTO wallets (id, owner_id, kind, balance_cents, created_at) VALUES (?, ?, ?, ?, ?)").run(
          walletId,
          id,
          input.role === "driver" ? "driver" : "customer",
          0,
          now,
        );
        if (input.role === "rider" && demoMode && input.demoStartingBalanceCents > 0) {
          recordLedgerOperation(db, {
            actorId: id,
            operation: "demo_starting_credit",
            idempotencyKey: `welcome:${id}`,
            entries: [{ walletId, amountCents: input.demoStartingBalanceCents, description: "Demo-only starting credits" }],
          });
        }
        return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord;
      });
      return publicUser(transaction());
    },
    getUserByEmail(email: string) {
      return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as (UserRecord & { password_hash: string }) | undefined;
    },
    getUserById(id: string) {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined;
      return user ? publicUser(user) : undefined;
    },
    createSession(input: { tokenHash: string; userId: string; csrfHash: string; expiresAt: string }) {
      db.prepare("INSERT INTO sessions (token_hash, user_id, csrf_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
        input.tokenHash, input.userId, input.csrfHash, input.expiresAt, new Date().toISOString(),
      );
    },
    getSession(tokenHash: string) {
      const session = db.prepare(
        `SELECT s.csrf_hash, s.expires_at, u.*
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      ).get(tokenHash, new Date().toISOString()) as (UserRecord & { csrf_hash: string; expires_at: string }) | undefined;
      return session;
    },
    deleteSession(tokenHash: string) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    },
    updateSessionCsrfHash(tokenHash: string, csrfHash: string) {
      db.prepare("UPDATE sessions SET csrf_hash = ? WHERE token_hash = ?").run(csrfHash, tokenHash);
    },
    saveQuote(quote: Omit<QuoteRecord, "id" | "created_at"> & { id?: string }) {
      const record: QuoteRecord = { ...quote, id: quote.id ?? randomUUID(), created_at: new Date().toISOString() };
      db.prepare(
        `INSERT INTO quotes
         (id, rider_id, pickup, destination, kind, fare_cents, distance_meters, duration_seconds, provider, expires_at, created_at)
         VALUES (@id, @rider_id, @pickup, @destination, @kind, @fare_cents, @distance_meters, @duration_seconds, @provider, @expires_at, @created_at)`,
      ).run(record);
      return record;
    },
    getQuoteForRider(id: string, riderId: string) {
      return db.prepare("SELECT * FROM quotes WHERE id = ? AND rider_id = ? AND expires_at > ?").get(
        id, riderId, new Date().toISOString(),
      ) as QuoteRecord | undefined;
    },
    requestTrip(actorId: string, quote: QuoteRecord, idempotencyKey: string) {
      const transaction = db.transaction(() => {
        const existingOperation = db.prepare(
          "SELECT trip_id FROM ledger_operations WHERE actor_id = ? AND idempotency_key = ?",
        ).get(actorId, idempotencyKey) as { trip_id: string | null } | undefined;
        if (existingOperation?.trip_id) {
          return db.prepare("SELECT * FROM trips WHERE id = ?").get(existingOperation.trip_id) as TripRecord;
        }
        const activeTrip = db.prepare(
          "SELECT id FROM trips WHERE rider_id = ? AND status IN ('requested', 'accepted')",
        ).get(actorId);
        if (activeTrip) throw new Error("Rider already has an active trip.");
        const tripId = randomUUID();
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO trips
           (id, rider_id, quote_id, status, pickup, destination, kind, fare_cents, driver_payout_cents, union_share_cents,
            distance_meters, duration_seconds, created_at)
           VALUES (?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          tripId, actorId, quote.id, quote.pickup, quote.destination, quote.kind, quote.fare_cents,
          Math.floor(quote.fare_cents * 0.8), quote.fare_cents - Math.floor(quote.fare_cents * 0.8),
          quote.distance_meters, quote.duration_seconds, now,
        );
        db.prepare(
          "INSERT INTO ledger_operations (id, idempotency_key, actor_id, trip_id, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(randomUUID(), idempotencyKey, actorId, tripId, "request_trip", now);
        return db.prepare("SELECT * FROM trips WHERE id = ?").get(tripId) as TripRecord;
      });
      return transaction();
    },
    getTrips(userId: string, role: AccountRole) {
      const column = role === "rider" ? "rider_id" : "driver_id";
      return db.prepare(`SELECT * FROM trips WHERE ${column} = ? ORDER BY created_at DESC LIMIT 100`).all(userId) as TripRecord[];
    },
    getTripById(id: string) {
      return db.prepare("SELECT * FROM trips WHERE id = ?").get(id) as TripRecord | undefined;
    },
    getAvailableTrips() {
      return db.prepare("SELECT * FROM trips WHERE status = 'requested' ORDER BY created_at LIMIT 50").all() as TripRecord[];
    },
    setDriverOnline(userId: string, online: boolean) {
      db.prepare("UPDATE users SET is_online = ? WHERE id = ? AND role = 'driver'").run(online ? 1 : 0, userId);
      return db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRecord;
    },
    listOnlineDrivers() {
      return db.prepare("SELECT id, name, created_at FROM users WHERE role = 'driver' AND driver_status = 'verified' AND is_online = 1").all();
    },
    verifyDriver(userId: string, approved: boolean) {
      const result = db.prepare(
        "UPDATE users SET driver_status = ?, is_online = 0 WHERE id = ? AND role = 'driver'",
      ).run(approved ? "verified" : "rejected", userId);
      if (result.changes === 0) return undefined;
      return db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRecord;
    },
    acceptTrip(input: { tripId: string; driverId: string; idempotencyKey: string; paymentReference: string }) {
      const transaction = db.transaction(() => {
        const previous = db.prepare(
          "SELECT trip_id FROM ledger_operations WHERE actor_id = ? AND idempotency_key = ?",
        ).get(input.driverId, input.idempotencyKey) as { trip_id: string | null } | undefined;
        if (previous?.trip_id === input.tripId) return db.prepare("SELECT * FROM trips WHERE id = ?").get(input.tripId) as TripRecord;
        const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(input.tripId) as TripRecord | undefined;
        if (!trip || trip.status !== "requested") return undefined;
        const user = db.prepare("SELECT driver_status, is_online FROM users WHERE id = ? AND role = 'driver'").get(input.driverId) as
          | { driver_status: DriverStatus; is_online: number }
          | undefined;
        if (!user || user.driver_status !== "verified" || user.is_online !== 1) return undefined;
        const activeTrip = db.prepare(
          "SELECT id FROM trips WHERE driver_id = ? AND status = 'accepted'",
        ).get(input.driverId);
        if (activeTrip) return undefined;
        const riderWalletId = db.prepare("SELECT id, balance_cents FROM wallets WHERE owner_id = ? AND kind = 'customer'").get(trip.rider_id) as
          | { id: string; balance_cents: number }
          | undefined;
        const driverWalletId = `${input.driverId}:driver`;
        const driverWallet = db.prepare("SELECT id FROM wallets WHERE id = ?").get(driverWalletId) as { id: string } | undefined;
        const unionWallet = db.prepare("SELECT id FROM wallets WHERE id = 'union'").get() as { id: string };
        if (!riderWalletId || riderWalletId.balance_cents < trip.fare_cents || !driverWallet) return undefined;
        const now = new Date().toISOString();
        db.prepare(
          "UPDATE trips SET driver_id = ?, status = 'accepted', payment_status = 'paid', payment_reference = ?, accepted_at = ? WHERE id = ? AND status = 'requested'",
        ).run(
          input.driverId, input.paymentReference, now, trip.id,
        );
        db.prepare(
          "INSERT INTO ledger_operations (id, idempotency_key, actor_id, trip_id, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(randomUUID(), input.idempotencyKey, input.driverId, trip.id, "accept_and_split_fare", now);
        const operationId = (db.prepare(
          "SELECT id FROM ledger_operations WHERE actor_id = ? AND idempotency_key = ?",
        ).get(input.driverId, input.idempotencyKey) as { id: string }).id;
        const entries = [
          { walletId: riderWalletId.id, amountCents: -trip.fare_cents, description: `Accepted fare · ${trip.destination}` },
          { walletId: unionWallet.id, amountCents: trip.fare_cents, description: `Customer payment routed · ${trip.destination}` },
          { walletId: unionWallet.id, amountCents: -trip.driver_payout_cents, description: `Driver payout (80%) · ${trip.destination}` },
          { walletId: driverWallet.id, amountCents: trip.driver_payout_cents, description: `Accepted ride payout · ${trip.destination}` },
        ];
        applyLedgerEntries(db, operationId, entries, trip.id);
        return db.prepare("SELECT * FROM trips WHERE id = ?").get(trip.id) as TripRecord;
      });
      return transaction();
    },
    cancelTrip(input: { tripId: string; userId: string; role: AccountRole; idempotencyKey: string }) {
      const transaction = db.transaction(() => {
        const previous = db.prepare(
          "SELECT trip_id FROM ledger_operations WHERE actor_id = ? AND idempotency_key = ?",
        ).get(input.userId, input.idempotencyKey) as { trip_id: string | null } | undefined;
        if (previous?.trip_id === input.tripId) return db.prepare("SELECT * FROM trips WHERE id = ?").get(input.tripId) as TripRecord;
        const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(input.tripId) as TripRecord | undefined;
        if (!trip || (input.role === "rider" ? trip.rider_id !== input.userId : trip.driver_id !== input.userId)) return undefined;
        if (trip.status !== "requested" && trip.status !== "accepted") return undefined;
        const now = new Date().toISOString();
        db.prepare(
          "UPDATE trips SET status = 'cancelled', payment_status = ?, cancelled_at = ? WHERE id = ?",
        ).run(trip.status === "accepted" ? "refunded" : "unpaid", now, trip.id);
        if (trip.status === "accepted" && trip.driver_id) {
          const operationId = randomUUID();
          db.prepare(
            "INSERT INTO ledger_operations (id, idempotency_key, actor_id, trip_id, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(operationId, input.idempotencyKey, input.userId, trip.id, "refund_accepted_fare", now);
          const riderWallet = db.prepare("SELECT id FROM wallets WHERE owner_id = ? AND kind = 'customer'").get(trip.rider_id) as { id: string };
          applyLedgerEntries(db, operationId, [
            { walletId: riderWallet.id, amountCents: trip.fare_cents, description: `Demo refund · ${trip.destination}` },
            { walletId: "union", amountCents: trip.driver_payout_cents, description: `Demo payout reversal · ${trip.destination}` },
            { walletId: `${trip.driver_id}:driver`, amountCents: -trip.driver_payout_cents, description: `Payout reversal · ${trip.destination}` },
            { walletId: "union", amountCents: -trip.fare_cents, description: `Refund routed · ${trip.destination}` },
          ], trip.id);
        }
        return db.prepare("SELECT * FROM trips WHERE id = ?").get(trip.id) as TripRecord;
      });
      return transaction();
    },
    completeTrip(input: { tripId: string; driverId: string; idempotencyKey: string }) {
      const existing = db.prepare(
        "SELECT trip_id FROM ledger_operations WHERE actor_id = ? AND idempotency_key = ?",
      ).get(input.driverId, input.idempotencyKey) as { trip_id: string | null } | undefined;
      if (existing?.trip_id === input.tripId) return db.prepare("SELECT * FROM trips WHERE id = ?").get(input.tripId) as TripRecord;
      const result = db.prepare(
        "UPDATE trips SET status = 'completed', completed_at = ? WHERE id = ? AND driver_id = ? AND status = 'accepted'",
      ).run(new Date().toISOString(), input.tripId, input.driverId);
      if (result.changes !== 1) return undefined;
      const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(input.tripId) as TripRecord;
      db.prepare(
        "INSERT INTO ledger_operations (id, idempotency_key, actor_id, trip_id, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(randomUUID(), input.idempotencyKey, input.driverId, trip.id, "complete_trip", new Date().toISOString());
      return trip;
    },
    addDemoFunds(userId: string, amountCents: number, idempotencyKey: string) {
      const existing = db.prepare(
        "SELECT id FROM ledger_operations WHERE actor_id = ? AND idempotency_key = ?",
      ).get(userId, idempotencyKey) as { id: string } | undefined;
      if (existing) return false;
      const wallet = db.prepare("SELECT id FROM wallets WHERE owner_id = ? AND kind = 'customer'").get(userId) as { id: string };
      const operationId = randomUUID();
      db.prepare(
        "INSERT INTO ledger_operations (id, idempotency_key, actor_id, trip_id, operation, created_at) VALUES (?, ?, ?, NULL, ?, ?)",
      ).run(operationId, idempotencyKey, userId, "demo_top_up", new Date().toISOString());
      applyLedgerEntries(db, operationId, [
        { walletId: wallet.id, amountCents, description: "Demo-only wallet top-up" },
      ]);
      return true;
    },
    getWallet(userId: string, role: AccountRole) {
      const walletId = `${userId}:${role === "driver" ? "driver" : "customer"}`;
      const wallet = db.prepare("SELECT balance_cents FROM wallets WHERE id = ?").get(walletId) as { balance_cents: number } | undefined;
      const kind = role === "driver" ? "driver" : "customer";
      const trips = db.prepare(
        `SELECT id, destination, fare_cents, driver_payout_cents, union_share_cents, payment_status
         FROM trips WHERE ${role === "driver" ? "driver_id" : "rider_id"} = ?`,
      ).all(userId) as Array<Pick<TripRecord, "id" | "destination" | "fare_cents" | "driver_payout_cents" | "union_share_cents" | "payment_status">>;
      const tripIds = trips.map((trip) => trip.id);
      const unionCents = trips.reduce((sum, trip) => sum + (trip.payment_status === "paid" ? trip.union_share_cents : 0), 0);
      const ownEntries = db.prepare(
        `SELECT e.id, e.amount_cents, e.description, e.created_at, w.kind AS wallet_kind, o.trip_id
         FROM ledger_entries e JOIN wallets w ON w.id = e.wallet_id
         JOIN ledger_operations o ON o.id = e.operation_id
         WHERE w.owner_id = ? AND w.kind = ?
         ORDER BY e.created_at DESC LIMIT 100`,
      ).all(userId, kind) as Array<Record<string, unknown>>;
      const unionEntries = tripIds.length
        ? db.prepare(
            `SELECT e.id, e.amount_cents, e.description, e.created_at, w.kind AS wallet_kind, o.trip_id
             FROM ledger_entries e JOIN wallets w ON w.id = e.wallet_id
             JOIN ledger_operations o ON o.id = e.operation_id
             WHERE w.id = 'union' AND o.trip_id IN (${tripIds.map(() => "?").join(",")})
             ORDER BY e.created_at DESC LIMIT 100`,
          ).all(...tripIds) as Array<Record<string, unknown>>
        : [];
      const transactions = [...ownEntries, ...unionEntries]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 100)
        .map((entry) => ({
          id: entry.id,
          wallet: entry.wallet_kind,
          direction: Number(entry.amount_cents) >= 0 ? "in" : "out",
          amountCents: Math.abs(Number(entry.amount_cents)),
          description: entry.description,
          rideId: entry.trip_id,
          createdAt: entry.created_at,
        }));
      return {
        balances: {
          customerCents: role === "rider" ? wallet?.balance_cents ?? 0 : undefined,
          driverCents: role === "driver" ? wallet?.balance_cents ?? 0 : undefined,
          unionCents,
        },
        transactions,
        trips,
      };
    },
  };
}

function recordLedgerOperation(
  db: Database.Database,
  input: {
    actorId: string;
    operation: string;
    idempotencyKey: string;
    entries: Array<{ walletId: string; amountCents: number; description: string }>;
  },
) {
  const operationId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO ledger_operations (id, idempotency_key, actor_id, operation, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(operationId, input.idempotencyKey, input.actorId, input.operation, now);
  applyLedgerEntries(db, operationId, input.entries);
}

function applyLedgerEntries(
  db: Database.Database,
  operationId: string,
  entries: Array<{ walletId: string; amountCents: number; description: string }>,
  tripId?: string,
) {
  const now = new Date().toISOString();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents === 0) throw new Error("Ledger entries must be non-zero integer cents.");
    const result = db.prepare(
      "UPDATE wallets SET balance_cents = balance_cents + ? WHERE id = ? AND balance_cents + ? >= 0",
    ).run(entry.amountCents, entry.walletId, entry.amountCents);
    if (result.changes !== 1) throw new Error("Insufficient wallet funds or wallet not found.");
    db.prepare(
      "INSERT INTO ledger_entries (id, operation_id, wallet_id, amount_cents, description, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(randomUUID(), operationId, entry.walletId, entry.amountCents, entry.description.slice(0, 240), now);
  }
  if (tripId) {
    db.prepare("UPDATE ledger_operations SET trip_id = ? WHERE id = ?").run(tripId, operationId);
  }
}
