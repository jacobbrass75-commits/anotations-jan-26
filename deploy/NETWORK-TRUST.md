# App Bind and Proxy Trust

How the app process decides who it listens to and which client IP it believes.
The code lives in `server/networkTrust.ts`.

## Topology this assumes

```
client ─► Cloudflare ─► nginx (same host) ─► app 127.0.0.1:5001
                          └─ MCP OAuth locations ─► app 127.0.0.1:5001
MCP server (same host) ──────────────────────────► app 127.0.0.1:5001
```

nginx sets `X-Forwarded-For $proxy_add_x_forwarded_for`, `X-Forwarded-Host` and
`X-Forwarded-Proto`. No nginx `real_ip` module is configured, so the app reads the
client IP from `X-Forwarded-For` itself.

## Behaviour

| Setting                     | Before                   | Now                                                                             |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| Listen address (production) | `0.0.0.0:5001`           | `127.0.0.1:5001` (`BIND_HOST`, set explicitly in `deploy/ecosystem.config.cjs`) |
| Listen address (dev/test)   | `0.0.0.0`                | unchanged (`0.0.0.0` unless `BIND_HOST` is set)                                 |
| Express `trust proxy`       | `true` (trust every hop) | loopback + Cloudflare ranges (same list OAuth already used)                     |

With `trust proxy` set to `true`, `req.ip` was the leftmost `X-Forwarded-For` entry,
which the client controls. A direct request to public port 5001 could also send
`X-Forwarded-Proto: https` and `X-Forwarded-Host` and have them trusted.

Now Express walks `X-Forwarded-For` from the right and stops at the first address
outside the trusted list:

| Path                                                | `req.ip`                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| Cloudflare → nginx → app                            | the client address Cloudflare appended                                         |
| client → nginx directly (origin IP)                 | the peer nginx saw; forged Cloudflare entries stay to its left and are ignored |
| attacker adds leftmost `X-Forwarded-For` entries    | ignored                                                                        |
| untrusted direct peer (only if `BIND_HOST=0.0.0.0`) | the socket address; all `X-Forwarded-*` headers ignored                        |

Normal Cloudflare traffic already resolved to the real client before this change,
so `express-rate-limit` keys and 429 rates should not move for ordinary users.

The OAuth limiter keeps its own logic and its `OAUTH_TRUSTED_PROXY_CIDRS` override.
That override does not affect Express `trust proxy`.

## Operator checklist

Read-only checks on the server before deploy:

1. Run `sudo ss -ltnp 'sport = :5001'` and note the current listener (`0.0.0.0:5001` expected).
2. Run `sudo grep -rn "5001" /etc/nginx/`. Every `proxy_pass` must target `127.0.0.1:5001`,
   not the public IP, `localhost` or `[::1]`. `localhost` can resolve to `::1`, which
   the app does not listen on.
3. Confirm the production `.env` does not set `BIND_HOST` to anything except `127.0.0.1`.
4. In Cloudflare, confirm no Origin Rule or Spectrum app rewrites the destination port to 5001.
5. Confirm nothing outside the host uses `http://<origin-ip>:5001`. See "Known direct
   consumers" below.
6. Compare the Cloudflare list in `server/networkTrust.ts` with
   <https://www.cloudflare.com/ips/>.

Deploy with the normal `deploy/refresh-prod.sh`. It runs
`pm2 startOrReload ... --update-env`, which picks up `BIND_HOST`. Its health checks
and smoke checks already use `127.0.0.1`.

After deploy:

1. Run `sudo ss -ltnp 'sport = :5001'`. It should show only `127.0.0.1:5001`.
2. Check that `deploy/refresh-prod.sh` health checks and smoke checks passed, and that
   public pages and MCP OAuth work through Cloudflare.
3. Watch 429 counts on `/api/auth`, `/oauth/*` and campaign routes for a day.

## Rollback

- Bind only: set `BIND_HOST=0.0.0.0` in `deploy/ecosystem.config.cjs`, or in the PM2 env,
  then run `pm2 startOrReload deploy/ecosystem.config.cjs --update-env`.
- Trust list: revert the commit. There is deliberately no runtime override for the
  Express trust list.

## Known direct consumers of port 5001

- `.claude/skills/scholarmark-thesis` (`SKILL.md`, `scripts/common.py`,
  `scripts/preflight.sh`) defaults to `SM=http://89.167.10.34:5001`: plain HTTP to the
  origin, bypassing nginx and Cloudflare. This stops working once the app binds
  loopback. Point `SM` at `https://app.scholarmark.ai` with authentication, or use an
  SSH tunnel. `preflight.sh` creates and deletes projects, so do not aim it at
  production casually.
- `EXTRA_ALLOWED_ORIGINS=http://89.167.10.34` (in `.env.example`) matches that host on
  any port, including `:5001`. This suggests browser pages were once loaded from the
  direct IP. Check whether production still sets it.
- `mcp-server/MCP-AUTH-GUIDE.md` draws `app.scholarmark.ai:5001`. This is documentation
  only; the shipped configs use `127.0.0.1:5001`.

## Residual risks and follow-ups

- Cloudflare-originated requests (for example from Workers) come from trusted ranges,
  so a caller in those ranges may be able to influence `req.ip`. The OAuth limiter
  already had the same assumption. Treat per-IP limits as best-effort.
- nginx on 80/443 is still reachable without Cloudflare. Restricting the origin to
  Cloudflare ranges, or using Authenticated Origin Pulls, is a separate firewall change.
- The MCP server still binds `0.0.0.0:5002`. Public 5002 timed out at the time of
  review, so a host firewall appears to cover it. A loopback default there is a
  candidate follow-up.
- If Cloudflare adds edge ranges before the list is updated, clients behind the new
  edges share the edge IP as their rate-limit key. That means more 429s, not spoofing.
