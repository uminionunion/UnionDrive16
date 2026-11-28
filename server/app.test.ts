import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import supertest from "supertest";
import type { AppConfig } from "./config";
import { createApp } from "./app";
import { createDatabase } from "./db";

const origin = "http://127.0.0.1:5173";

function setup() {
  const config: AppConfig = {
    environment: "test",
    port: 3001,
    appOrigin: origin,
    databasePath: ":memory:",
    sessionSecret: "test-session-secret-with-more-than-thirty-two-characters",
    sessionTtlHours: 24,
    demoMode: true,
    mapProvider: "demo",
    adminApiToken: "test-operator-token",
    paymentProvider: "demo",
  };
  const database = createDatabase(":memory:", true);
  const app = createApp(config, database);
  return { app, database, config };
}

async function signUp(
  agent: ReturnType<typeof supertest.agent>,
  role: "rider" | "driver",
  email = `${role}-${randomUUID()}@example.test`,
) {
  const response = await agent
    .post("/api/auth/register")
    .set("Origin", origin)
    .send({ name: "Test User", email, password: "A-long-demo-passphrase-16!", role })
    .expect(201);
  return response.body as { user: { id: string; role: string }; csrfToken: string };
}

test("rider requests a fare, driver acceptance atomically splits it, and cancellation refunds it once", async () => {
  const { app, database } = setup();
  const rider = supertest.agent(app);
  const driver = supertest.agent(app);
  const riderSession = await signUp(rider, "rider");
  const driverSession = await signUp(driver, "driver");

  const initialWallet = await rider.get("/api/wallet").expect(200).expect("Cache-Control", "no-store");
  assert.equal(initialWallet.body.balances.customerCents, 25_000);
  assert.equal(initialWallet.body.balances.unionCents, 0);

  const quote = await rider
    .post("/api/quotes")
    .set("Origin", origin)
    .set("X-CSRF-Token", riderSession.csrfToken)
    .send({ pickup: "Union Square", destination: "Ferry Building", kind: "Everyday" })
    .expect(201);
  assert.equal(quote.body.provider, "demo-estimate");
  assert.ok(quote.body.fareCents > 0);

  const idempotencyKey = randomUUID();
  const trip = await rider
    .post("/api/trips")
    .set("Origin", origin)
    .set("X-CSRF-Token", riderSession.csrfToken)
    .set("Idempotency-Key", idempotencyKey)
    .send({ quoteId: quote.body.id })
    .expect(201);
  assert.equal(trip.body.status, "requested");
  assert.equal(trip.body.paymentStatus, "unpaid");
  assert.equal((await rider.get("/api/wallet").expect(200)).body.balances.customerCents, 25_000);

  database.verifyDriver(driverSession.user.id, true);
  await driver
    .patch("/api/driver/availability")
    .set("Origin", origin)
    .set("X-CSRF-Token", driverSession.csrfToken)
    .send({ online: true })
    .expect(200);

  const accepted = await driver
    .post(`/api/trips/${trip.body.id}/accept`)
    .set("Origin", origin)
    .set("X-CSRF-Token", driverSession.csrfToken)
    .set("Idempotency-Key", randomUUID())
    .expect(200);
  assert.equal(accepted.body.status, "accepted");
  assert.equal(accepted.body.paymentStatus, "paid");
  assert.equal(accepted.body.fareCents, accepted.body.driverPayoutCents + accepted.body.unionShareCents);
  assert.equal(accepted.body.driverPayoutCents, Math.floor(accepted.body.fareCents * 0.8));

  const riderWallet = await rider.get("/api/wallet").expect(200);
  const driverWallet = await driver.get("/api/wallet").expect(200);
  assert.equal(riderWallet.body.balances.customerCents, 25_000 - accepted.body.fareCents);
  assert.equal(riderWallet.body.balances.unionCents, accepted.body.unionShareCents);
  assert.equal(driverWallet.body.balances.driverCents, accepted.body.driverPayoutCents);
  assert.equal(driverWallet.body.balances.unionCents, accepted.body.unionShareCents);

  const refundKey = randomUUID();
  const cancelled = await rider
    .post(`/api/trips/${trip.body.id}/cancel`)
    .set("Origin", origin)
    .set("X-CSRF-Token", riderSession.csrfToken)
    .set("Idempotency-Key", refundKey)
    .expect(200);
  assert.equal(cancelled.body.status, "cancelled");
  assert.equal(cancelled.body.paymentStatus, "refunded");
  assert.equal((await rider.get("/api/wallet").expect(200)).body.balances.customerCents, 25_000);
  assert.equal((await driver.get("/api/wallet").expect(200)).body.balances.driverCents, 0);
  assert.equal((await driver.get("/api/wallet").expect(200)).body.balances.unionCents, 0);
  database.close();
});

test("API rejects missing CSRF tokens, wrong origins, and role escalation", async () => {
  const { app, database } = setup();
  const rider = supertest.agent(app);
  const session = await signUp(rider, "rider");

  await rider
    .post("/api/quotes")
    .set("Origin", origin)
    .send({ pickup: "Union Square", destination: "Ferry Building", kind: "Everyday" })
    .expect(403);
  await rider
    .post("/api/quotes")
    .set("Origin", "https://not-our-site.invalid")
    .set("X-CSRF-Token", session.csrfToken)
    .send({ pickup: "Union Square", destination: "Ferry Building", kind: "Everyday" })
    .expect(403);
  await rider
    .patch("/api/driver/availability")
    .set("Origin", origin)
    .set("X-CSRF-Token", session.csrfToken)
    .send({ online: true })
    .expect(403);
  await rider
    .post("/api/wallet/demo-topups")
    .set("Origin", origin)
    .set("X-CSRF-Token", session.csrfToken)
    .set("Idempotency-Key", randomUUID())
    .send({ amountCents: 2_500, extra: true })
    .expect(400);
  database.close();
});

test("demo credits are server-owned, restricted to fixed amounts, and idempotent", async () => {
  const { app, database } = setup();
  const rider = supertest.agent(app);
  const session = await signUp(rider, "rider");
  const key = randomUUID();

  await rider
    .post("/api/wallet/demo-topups")
    .set("Origin", origin)
    .set("X-CSRF-Token", session.csrfToken)
    .set("Idempotency-Key", key)
    .send({ amountCents: 5_000 })
    .expect(200);
  await rider
    .post("/api/wallet/demo-topups")
    .set("Origin", origin)
    .set("X-CSRF-Token", session.csrfToken)
    .set("Idempotency-Key", key)
    .send({ amountCents: 5_000 })
    .expect(409);
  assert.equal((await rider.get("/api/wallet").expect(200)).body.balances.customerCents, 30_000);
  database.close();
});
