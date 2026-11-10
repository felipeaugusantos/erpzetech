// Server-only: import dynamically inside authenticated server handlers.
import { getUserAccessToken, lovableProvider } from "@lovable.dev/lovable-auth-js/server";
import { getRequest } from "@tanstack/react-start/server";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Conexão não configurada: ${name}`);
  return value;
}
async function gatewayToken(): Promise<string> {
  const subjectToken = getRequest()?.headers.get("x-lovable-identity-token");
  if (!subjectToken) throw new Error("Identidade não disponível.");
  return getUserAccessToken({
    subjectToken,
    audience: "urn:lovable:service:connector-gateway",
    scope: "connector:invoke",
    provider: lovableProvider({
      tenantId: env("LOVABLE_CONNECTOR_TENANT_ID"),
      clientId: env("LOVABLE_CONNECTOR_OAUTH_CLIENT_ID"),
      clientSecret: env("LOVABLE_CONNECTOR_OAUTH_CLIENT_SECRET"),
    }),
  });
}
export async function authorizeAppUserOAuth(params: {
  gatewayBaseUrl: string;
  connectorId: string;
  appUserId: string;
  clientAPIKey: string;
  returnUrl: string;
  credentialsConfiguration?: Record<string, unknown>;
  responseMode?: "redirect" | "web_message";
  webMessageTargetOrigin?: string;
}) {
  const bearer =
    params.responseMode === "web_message" ? await gatewayToken() : env("LOVABLE_API_KEY");
  const res = await fetch(`${params.gatewayBaseUrl}/api/v1/app-users/oauth2/authorize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      "X-Client-Api-Key": params.clientAPIKey,
    },
    body: JSON.stringify({
      connector_id: params.connectorId,
      app_user_id: params.appUserId,
      return_url: params.returnUrl,
      credentials_configuration: params.credentialsConfiguration,
      response_mode: params.responseMode,
      web_message_target_origin: params.webMessageTargetOrigin,
      omit_connection_key: params.responseMode === "web_message",
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth [${res.status}]: ${text}`);
  const body = JSON.parse(text) as { authorization_url?: string; session_id?: string };
  if (!body.authorization_url) throw new Error("Endereço de autorização não recebido.");
  return { authorizationUrl: body.authorization_url, sessionId: body.session_id ?? "" };
}
export async function exchangeAppUserOAuthCode(gatewayBaseUrl: string, code: string) {
  const res = await fetch(`${gatewayBaseUrl}/api/v1/app-users/oauth2/exchange`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("LOVABLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth exchange [${res.status}]: ${text}`);
  const body = JSON.parse(text) as { api_key?: string; connector_id?: string };
  if (!body.api_key || !body.connector_id) throw new Error("Conexão não recebida.");
  return { connectionAPIKey: body.api_key, connectorId: body.connector_id };
}
export async function callAsAppUser(params: {
  gatewayBaseUrl: string;
  connectorId: string;
  connectionAPIKey?: string;
  path: string;
  init?: RequestInit;
  requiredScopes?: string[];
}) {
  const headers = new Headers(params.init?.headers);
  headers.set(
    "Authorization",
    `Bearer ${params.connectionAPIKey ? env("LOVABLE_API_KEY") : await gatewayToken()}`,
  );
  if (params.connectionAPIKey) headers.set("X-Connection-Api-Key", params.connectionAPIKey);
  if (params.requiredScopes?.length)
    headers.set("X-Lovable-Required-Scopes", params.requiredScopes.join(" "));
  return fetch(
    `${params.gatewayBaseUrl}/${params.connectorId}${params.path.startsWith("/") ? params.path : `/${params.path}`}`,
    { ...params.init, headers },
  );
}
export async function appUserReconnectRequired(res: Response) {
  if (res.status !== 401) return false;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { type?: string } | null;
  return typeof body?.type === "string" && body.type.startsWith("credential_");
}
export async function disconnectAppUser(params: {
  gatewayBaseUrl: string;
  connectorId: string;
  connectionAPIKey: string;
}) {
  const res = await fetch(`${params.gatewayBaseUrl}/api/v1/app-users/connection`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${env("LOVABLE_API_KEY")}`,
      "X-Connection-Api-Key": params.connectionAPIKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ connector_id: params.connectorId }),
  });
  if (!res.ok) throw new Error(`Disconnect [${res.status}]: ${await res.text()}`);
}
