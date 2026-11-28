import type { RideKind } from "./db";
import type { AppConfig } from "./config";

export type RouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
};

const rideMultiplier: Record<RideKind, number> = {
  Everyday: 1,
  Comfort: 1.5,
  XL: 2,
};

export async function estimateRoute(
  config: AppConfig,
  input: { pickup: string; destination: string; kind: RideKind },
): Promise<{ route: RouteResult; fareCents: number }> {
  const route = config.mapProvider === "mapbox"
    ? await mapboxRoute(config.mapboxAccessToken!, input.pickup, input.destination)
    : demoRoute(input.pickup, input.destination);
  const baseCents = 350;
  const distanceCents = Math.round((route.distanceMeters / 1000) * 175);
  const timeCents = Math.round((route.durationSeconds / 60) * 35);
  const fareCents = Math.max(800, Math.round((baseCents + distanceCents + timeCents) * rideMultiplier[input.kind]));
  return { route, fareCents };
}

function demoRoute(pickup: string, destination: string): RouteResult {
  const distanceMeters = Math.max(1500, Math.min(42_000, (pickup.length + destination.length) * 230));
  return {
    distanceMeters,
    durationSeconds: Math.max(300, Math.round(distanceMeters / 7.5)),
    provider: "demo-estimate",
  };
}

async function mapboxRoute(token: string, pickup: string, destination: string): Promise<RouteResult> {
  const [origin, target] = await Promise.all([geocode(token, pickup), geocode(token, destination)]);
  const coordinates = `${origin[0]},${origin[1]};${target[0]},${target[1]}`;
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("overview", "false");
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new ProviderError("ROUTING_UNAVAILABLE", "Route provider could not calculate this trip.");
  const data: unknown = await response.json();
  if (!isRecord(data) || !Array.isArray(data.routes) || !isRecord(data.routes[0])) {
    throw new ProviderError("ROUTING_UNAVAILABLE", "Route provider returned an invalid response.");
  }
  const distance = data.routes[0].distance;
  const duration = data.routes[0].duration;
  if (typeof distance !== "number" || typeof duration !== "number" || distance <= 0 || duration <= 0) {
    throw new ProviderError("ROUTING_UNAVAILABLE", "Route provider returned an invalid distance or duration.");
  }
  return { distanceMeters: Math.round(distance), durationSeconds: Math.round(duration), provider: "mapbox" };
}

async function geocode(token: string, search: string): Promise<[number, number]> {
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(search)}.json`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new ProviderError("GEOCODING_UNAVAILABLE", "Address provider could not find this location.");
  const data: unknown = await response.json();
  if (
    !isRecord(data) ||
    !Array.isArray(data.features) ||
    !isRecord(data.features[0]) ||
    !Array.isArray(data.features[0].center) ||
    typeof data.features[0].center[0] !== "number" ||
    typeof data.features[0].center[1] !== "number"
  ) {
    throw new ProviderError("ADDRESS_NOT_FOUND", "Could not resolve one of the trip addresses.");
  }
  return [data.features[0].center[0], data.features[0].center[1]];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
