export const ROUTES = {
  docs: "#/how-it-works",
  simulator: "#/simulator",
  live: "#/live",
  liveCreate: "#/live/create",
  pitch: "#/pitch",
} as const;

// The talk, one address per slide so that coming back from the demo lands on the same one.
export function pitchRoute(slide: number): string {
  return slide === 0 ? ROUTES.pitch : `${ROUTES.pitch}/${slide + 1}`;
}

export function pitchSlideFromRoute(route: string): number | null {
  if (route === ROUTES.pitch) return 0;
  if (!route.startsWith(`${ROUTES.pitch}/`)) return null;
  const slide = Number(route.slice(ROUTES.pitch.length + 1));
  return Number.isInteger(slide) && slide >= 1 ? slide - 1 : 0;
}

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
