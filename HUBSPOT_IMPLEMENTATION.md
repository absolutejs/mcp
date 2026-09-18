HubSpot OAuth support — September 17, 2026

Included in @absolutejs/mcp 0.26.3. Adds optional confidential OAuth client authentication to code and refresh token exchange. Secrets are excluded from authorization URLs and resource requests. The host must supply a durable per-user token store and approval policy. OAuth tests cover PKCE, client authentication and refresh. Live HubSpot validation remains required.
