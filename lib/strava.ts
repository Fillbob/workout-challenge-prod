import { getSiteUrl } from "@/lib/utils";

const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_SCOPE = "activity:read_all";

export interface StravaTokenResponse {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  athlete?: { id: number };
  scope?: string[] | string;
}

function getClientConfig() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing Strava client configuration");
  }

  return { clientId, clientSecret };
}

export function buildStravaAuthUrl(state: string) {
  const { clientId } = getClientConfig();
  const redirectUri = getStravaRedirectUri();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: STRAVA_SCOPE,
    approval_prompt: "auto",
    state,
  });

  return `${STRAVA_AUTH_URL}?${params.toString()}`;
}

export function getStravaRedirectUri() {
  return `${getSiteUrl()}/api/strava/redirect`;
}

export async function exchangeAuthorizationCode(code: string) {
  const { clientId, clientSecret } = getClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
  });

  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange Strava code: ${error}`);
  }

  return (await response.json()) as StravaTokenResponse;
}

export async function refreshStravaToken(refreshToken: string) {
  const { clientId, clientSecret } = getClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh Strava token: ${error}`);
  }

  return (await response.json()) as StravaTokenResponse;
}

export function mapStravaScope(scope: string[] | string | undefined) {
  if (!scope) return STRAVA_SCOPE;
  if (Array.isArray(scope)) return scope.join(",");
  return scope;
}

export function getScopeString() {
  return STRAVA_SCOPE;
}
