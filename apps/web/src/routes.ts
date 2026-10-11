export const ROUTES = {
  docs: "#/how-it-works",
  simulator: "#/simulator",
  live: "#/live",
  liveCreate: "#/live/create",
} as const;

export const LIVE_SCENARIO_ROUTE = "#/live/scenario/";

export function liveScenarioRoute(address: string): string {
  return `${LIVE_SCENARIO_ROUTE}${address}`;
}

export function scenarioAddressFromRoute(route: string): string | null {
  return route.startsWith(LIVE_SCENARIO_ROUTE)
    ? route.slice(LIVE_SCENARIO_ROUTE.length) || null
    : null;
}

// The graph of everything a wallet holds that is backed by one token, scenario or not.
export const LIVE_TOKEN_ROUTE = "#/live/token/";

export function liveTokenRoute(mint: string): string {
  return `${LIVE_TOKEN_ROUTE}${mint}`;
}

export function tokenFromRoute(route: string): string | null {
  return route.startsWith(LIVE_TOKEN_ROUTE) ? route.slice(LIVE_TOKEN_ROUTE.length) || null : null;
}
