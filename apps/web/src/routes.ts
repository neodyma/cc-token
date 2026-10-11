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
