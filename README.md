# n8n-nodes-ipquery

Nodo community de [n8n](https://n8n.io) para **[ipquery.io](https://ipquery.io/#endpoints)**:
geolocalización y datos de IP. UI en español. **Sin API key y por HTTPS.**

## Qué da

`ip`, `isp {asn, org, isp}`, `location {country, country_code, state, city, zipcode, latitude,
longitude, timezone, localtime}` y `risk {is_mobile, is_vpn, is_tor, is_proxy, is_datacenter,
risk_score}`.

## Los flags de riesgo no son confiables para decidir seguridad

Medición propia del **2026-07-28** contra IPs de naturaleza conocida:

| IP | Qué es | ipquery | ip-api |
|---|---|---|---|
| `185.220.101.1` | salida Tor conocida | `is_tor: false`, `is_proxy: false`, `risk_score: 0` | `proxy: true` |
| `171.25.193.25` | salida Tor conocida (DFRI) | `is_tor: false`, `is_proxy: false`, `risk_score: 0` | `proxy: true` |
| `45.33.32.156` | datacenter (Linode) | `is_datacenter: true` | `hosting: true` |
| `8.8.8.8` | datacenter (Google) | `is_datacenter: true` | `hosting: true` |

**Conclusión**: usar este servicio para **geolocalización, ASN/ISP y detección de datacenter**
(donde coincidió 4/4 con ip-api). Para **reputación** (proxy/VPN/Tor), usar
[n8n-nodes-ip-api](https://git.sockets.ar/hernan/n8n-nodes-ip-api) u otra fuente. El nodo muestra
este aviso en la propia UI.

## Ventajas sobre el tier gratuito de ip-api

| | ipquery | ip-api (free) |
|---|---|---|
| TLS | **HTTPS** | HTTP plano |
| API key | no necesita | no necesita |
| Uso comercial | sin restricción declarada | **no permitido** |
| Lote | IPs separadas por coma en la URL (300 probadas OK) | `POST /batch`, 100 máx |
| Rate limit | sin límite documentado ni headers | 45/min (15/min en lote), ban de 1 h |

## Operaciones

| Operación | Endpoint |
|---|---|
| **Consultar IP** | `GET /{ip}` - v4 y v6. **No acepta dominios** |
| **Consulta en Lote** | `GET /{ip1,ip2,…}` - toma la IP de cada item de entrada |
| **Consultar Mi IP** | `GET /?format=json` |

Opciones: **aplanar resultado** (objeto plano en vez de anidado, para comparar con otras fuentes),
**tamaño de lote** y **TTL de caché** por IP.

Marcado `usableAsTool`: n8n genera la variante **IPQuery Tool** para AI Agents.

## Una IP privada devuelve 200, no un error

```json
{"ip":"192.168.1.1","isp":{"asn":"AS0","org":"","isp":""},
 "location":{"country":"","city":"","latitude":0.0165,"longitude":0.0153,…}}
```

Campos vacíos y coordenadas basura cerca de (0,0). Si no se detecta, el workflow cree que
geolocalizó algo y termina apuntando a *null island*. El nodo agrega **`found: false`** cuando el
país viene vacío y el ASN es `AS0`. Una IP mal formada sí devuelve **404** con cuerpo de texto.

## Uso típico: enriquecer alertas de Wazuh

```
[Wazuh Trigger] > [IPQuery: Lote, Campo Con La IP = data.srcip] > [IF geo.isDatacenter] > [aviso]
```

El resultado se agrega a cada item bajo la clave **`geo`**, sin pisar la alerta original.

## Desarrollo

```bash
npm install
npm run build
npm run lint
node tools/smoke.mjs   # 8 chequeos contra la API real
```

> **No correr `npm run lintfix` sobre strings con acentos**: el autofix de sentence-case de
> `eslint-plugin-n8n-nodes-base` corrompe UTF-8.

## Instalación (custom folder)

```bash
npm run build && npm pack
docker cp n8n-nodes-ipquery-0.1.0.tgz <container>:/tmp/
docker exec -u root <container> sh -c "cd /tmp && tar xzf n8n-nodes-ipquery-0.1.0.tgz \
  && mkdir -p /home/node/.n8n/custom/n8n-nodes-ipquery \
  && cp -r package/package.json package/dist /home/node/.n8n/custom/n8n-nodes-ipquery/ \
  && chown -R node:node /home/node/.n8n/custom"
docker compose restart n8n
```

Tipo del nodo: `CUSTOM.ipQuery` (y `CUSTOM.ipQueryTool` para agentes).

## Licencia

MIT.
