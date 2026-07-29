# n8n-nodes-ipquery

An [n8n](https://n8n.io) community node for **[ipquery.io](https://ipquery.io/#endpoints)**:
IP geolocation and network data. **No API key, served over HTTPS.**

## What it returns

`ip`, `isp {asn, org, isp}`, `location {country, country_code, state, city, zipcode, latitude,
longitude, timezone, localtime}` and `risk {is_mobile, is_vpn, is_tor, is_proxy, is_datacenter,
risk_score}`.

## The risk flags are not dependable for security decisions

Measured on 2026-07-28 against addresses of known nature:

| IP | What it is | ipquery | ip-api |
|---|---|---|---|
| `185.220.101.1` | known Tor exit relay | `is_tor: false`, `is_proxy: false`, `risk_score: 0` | `proxy: true` |
| `171.25.193.25` | known Tor exit relay (DFRI) | `is_tor: false`, `is_proxy: false`, `risk_score: 0` | `proxy: true` |
| `45.33.32.156` | datacenter (Linode) | `is_datacenter: true` | `hosting: true` |
| `8.8.8.8` | datacenter (Google) | `is_datacenter: true` | `hosting: true` |

Use this service for **geolocation, ASN/ISP and datacenter detection**, where it matched ip-api on
all four samples. For **reputation** (proxy/VPN/Tor) use another source. The node shows this warning
in its own UI.

## Compared to the free ip-api tier

| | ipquery | ip-api (free) |
|---|---|---|
| TLS | **HTTPS** | plain HTTP |
| API key | not needed | not needed |
| Commercial use | no stated restriction | **not allowed** |
| Bulk | comma separated in the URL (300 verified) | `POST /batch`, 100 max |
| Rate limit | none documented, no headers | 45/min (15/min bulk), 1 hour ban |

## Operations

| Operation | Endpoint |
|---|---|
| **Look Up IP** | `GET /{ip}` - IPv4 and IPv6. **Domain names are not accepted** |
| **Look Up Many (Bulk)** | `GET /{ip1,ip2,...}` - takes the IP from every input item |
| **Look Up Own IP** | `GET /?format=json` |

Options: **flatten result** (flat object instead of the nested shape, easier to compare against
other providers), **batch size** and **per-IP cache TTL**.

The node is marked `usableAsTool`, so n8n also exposes an **IPQuery Tool** variant for AI Agents.

## A private IP answers 200, not an error

```json
{"ip":"192.168.1.1","isp":{"asn":"AS0","org":"","isp":""},
 "location":{"country":"","city":"","latitude":0.0165,"longitude":0.0153}}
```

Empty fields and junk coordinates near (0,0). Left undetected, a workflow believes it geolocated
something and ends up pointing at null island. The node adds **`found: false`** when the country is
empty and the ASN is `AS0`. A malformed address does return **404** with a plain text body.

## Typical use: enriching security alerts

```
[Trigger] -> [IPQuery: Bulk, Field With the IP = data.srcip] -> [IF geo.isDatacenter] -> [notify]
```

Results are attached to each item under the **`geo`** key, leaving the original payload untouched.

## Languages

The node UI ships in English. A Spanish translation is included: set `N8N_DEFAULT_LOCALE=es` on your
n8n instance and the node's labels, descriptions and placeholders switch to Spanish.

Translations live in `nodes/IpQuery/translations/<locale>/ipQuery.json`. The file name must match
the node's `name` property, which is how n8n resolves it.

## Development

```bash
npm install
npm run build          # tsc + icons + translations + dist verification
npm run lint
node tools/smoke.mjs   # 8 checks against the live API
```

`npm run build` ends with `tools/verify-build.mjs`, which fails the build if anything declared
(nodes, credentials, icons, translations) is missing from `dist`.

## Install (custom folder)

```bash
npm run build && npm pack
docker cp n8n-nodes-ipquery-0.1.0.tgz <container>:/tmp/
docker exec -u root <container> sh -c "cd /tmp && tar xzf n8n-nodes-ipquery-0.1.0.tgz \
  && mkdir -p /home/node/.n8n/custom/n8n-nodes-ipquery \
  && cp -r package/package.json package/dist /home/node/.n8n/custom/n8n-nodes-ipquery/ \
  && chown -R node:node /home/node/.n8n/custom"
docker compose restart n8n
```

Node type: `CUSTOM.ipQuery` (and `CUSTOM.ipQueryTool` for agents).

## License

MIT.
