import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

const BASE_URL = 'https://api.ipquery.io';
/** Tope por request. El límite real es el largo de la URL, no la cantidad. */
const BATCH_MAX = 200;

interface CacheEntry {
	expiresAt: number;
	data: IDataObject;
}

/**
 * IPQuery - geolocalización y datos de IP con ipquery.io.
 *
 * Sin API key y por **HTTPS**, que es la diferencia práctica más grande con el
 * endpoint gratuito de ip-api (HTTP plano). Consulta en lote metiendo las IPs
 * separadas por coma en la propia URL.
 *
 * **Los flags de riesgo no son confiables para decisiones de seguridad.**
 * Medido el 2026-07-28 contra dos relays de salida de Tor conocidos
 * (`185.220.101.1`, `171.25.193.25`): ipquery devuelve `is_tor: false`,
 * `is_proxy: false` y `risk_score: 0`, mientras que ip-api marca `proxy: true`
 * en ambos. Donde sí coincide es en `is_datacenter` (4/4 con el `hosting` de
 * ip-api). Úsese para **geo, ASN/ISP y datacenter**; para reputación
 * (proxy/VPN/Tor) usar ip-api u otra fuente.
 */
export class IpQuery implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IPQuery',
		name: 'ipQuery',
		icon: 'file:ipQuery.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Geolocaliza y enriquece direcciones IP con ipquery.io',
		defaults: { name: 'IPQuery' },
		inputs: ['main'],
		outputs: ['main'],
		usableAsTool: true,
		credentials: [],
		properties: [
			{
				displayName:
					'ipquery.io no necesita API key y responde por HTTPS. Sus flags de riesgo (proxy/VPN/Tor) son poco confiables: en pruebas contra salidas de Tor conocidas devolvió is_tor false. Para reputación usá ip-api; esto sirve para geolocalización, ASN/ISP y detección de datacenter.',
				name: 'accuracyNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Operación',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'lookup',
				options: [
					{
						name: 'Consulta en Lote',
						value: 'batch',
						action: 'Consultar varias IP en lote',
						description:
							'Toma la IP de cada item de entrada y consulta muchas por request, separadas por coma en la URL',
					},
					{
						name: 'Consultar IP',
						value: 'lookup',
						action: 'Consultar una IP',
						description: 'Geolocaliza una IP v4 o v6',
					},
					{
						name: 'Consultar Mi IP',
						value: 'mine',
						action: 'Consultar la IP propia',
						description: 'Devuelve los datos de la IP pública desde la que sale n8n',
					},
				],
			},
			{
				displayName: 'IP',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				placeholder: '8.8.8.8',
				displayOptions: { show: { operation: ['lookup'] } },
				description: 'Dirección IP v4 o v6 a consultar. Este servicio no acepta nombres de dominio.',
			},
			{
				displayName: 'Campo Con La IP',
				name: 'ipField',
				type: 'string',
				default: 'ip',
				required: true,
				placeholder: 'data.srcip',
				displayOptions: { show: { operation: ['batch'] } },
				description:
					'Nombre del campo de cada item que contiene la IP. Admite rutas anidadas con puntos, por ejemplo data.srcip para una alerta de Wazuh.',
			},
			{
				displayName: 'Opciones',
				name: 'options',
				type: 'collection',
				placeholder: 'Agregar Opción',
				default: {},
				options: [
					{
						displayName: 'Aplanar Resultado',
						name: 'flatten',
						type: 'boolean',
						default: false,
						description:
							'Si la respuesta se devuelve como un objeto plano (country, city, asn, isDatacenter…) en vez de la estructura anidada de la API. Facilita comparar con la salida de otros servicios.',
					},
					{
						displayName: 'Tamaño Del Lote',
						name: 'batchSize',
						type: 'number',
						default: 100,
						typeOptions: { minValue: 1, maxValue: BATCH_MAX },
						description:
							'Cuántas IP se piden por request. El límite real no es la cantidad sino el largo de la URL: 300 IPv4 son unos 2800 caracteres.',
					},
					{
						displayName: 'TTL De Caché (Segundos)',
						name: 'cacheTtl',
						type: 'number',
						default: 3600,
						typeOptions: { minValue: 0 },
						description:
							'Cuánto se reutiliza el resultado de una IP ya consultada, dentro del mismo workflow. 0 desactiva la caché.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as string;
		const options = this.getNodeParameter('options', 0, {}) as IDataObject;
		const cacheTtl = (options.cacheTtl ?? 3600) as number;
		const flatten = (options.flatten ?? false) as boolean;
		const batchSize = Math.min((options.batchSize ?? 100) as number, BATCH_MAX);

		const staticData = this.getWorkflowStaticData('node') as { cache?: Record<string, CacheEntry> };
		if (cacheTtl > 0 && !staticData.cache) staticData.cache = {};
		const cache = staticData.cache;

		const getCached = (ip: string): IDataObject | undefined => {
			if (!cache) return undefined;
			const hit = cache[ip];
			if (!hit) return undefined;
			if (hit.expiresAt < Date.now()) {
				delete cache[ip];
				return undefined;
			}
			return hit.data;
		};
		const setCached = (ip: string, data: IDataObject) => {
			if (!cache || !ip) return;
			cache[ip] = { expiresAt: Date.now() + cacheTtl * 1000, data };
		};

		/**
		 * Una IP privada o reservada devuelve HTTP 200 con los campos vacíos y
		 * coordenadas basura cerca de (0,0) - no un error. Si no se detecta, el
		 * workflow cree que geolocalizó algo y termina apuntando a "null island".
		 * Se marca explícitamente con `found: false`.
		 */
		const isEmptyResult = (data: IDataObject): boolean => {
			const location = (data.location ?? {}) as IDataObject;
			const isp = (data.isp ?? {}) as IDataObject;
			return !location.country && (!isp.asn || isp.asn === 'AS0');
		};

		const decorate = (data: IDataObject): IDataObject => {
			const found = !isEmptyResult(data);
			if (!flatten) return { ...data, found };
			const location = (data.location ?? {}) as IDataObject;
			const isp = (data.isp ?? {}) as IDataObject;
			const risk = (data.risk ?? {}) as IDataObject;
			return {
				ip: data.ip,
				found,
				country: location.country,
				countryCode: location.country_code,
				state: location.state,
				city: location.city,
				zipcode: location.zipcode,
				latitude: location.latitude,
				longitude: location.longitude,
				timezone: location.timezone,
				localtime: location.localtime,
				asn: isp.asn,
				org: isp.org,
				isp: isp.isp,
				isMobile: risk.is_mobile,
				isVpn: risk.is_vpn,
				isTor: risk.is_tor,
				isProxy: risk.is_proxy,
				isDatacenter: risk.is_datacenter,
				riskScore: risk.risk_score,
			};
		};

		const request = async (path: string): Promise<unknown> =>
			this.helpers.httpRequest({
				method: 'GET',
				url: `${BASE_URL}/${path}`,
				json: true,
			});

		const out: INodeExecutionData[] = [];

		// --- Consulta en lote ---------------------------------------------------
		if (operation === 'batch') {
			const ipField = this.getNodeParameter('ipField', 0) as string;
			const readPath = (obj: IDataObject, path: string): unknown =>
				path.split('.').reduce<unknown>((acc, key) => (acc as IDataObject)?.[key], obj);

			const perItemIp = items.map((item) => {
				const value = readPath(item.json, ipField);
				return typeof value === 'string' ? value.trim() : '';
			});

			const results = new Map<string, IDataObject>();
			const pending: string[] = [];
			for (const ip of perItemIp) {
				if (!ip || results.has(ip) || pending.includes(ip)) continue;
				const cached = getCached(ip);
				if (cached) results.set(ip, cached);
				else pending.push(ip);
			}

			for (let i = 0; i < pending.length; i += batchSize) {
				const chunk = pending.slice(i, i + batchSize);
				// Un único elemento devuelve un objeto, no un array: se normaliza.
				const response = (await request(chunk.join(','))) as IDataObject | IDataObject[];
				const list = Array.isArray(response) ? response : [response];
				for (const entry of list) {
					const ip = String(entry.ip ?? '');
					const decorated = decorate(entry);
					if (ip) {
						results.set(ip, decorated);
						if (decorated.found) setCached(ip, decorated);
					}
				}
			}

			items.forEach((item, index) => {
				const ip = perItemIp[index];
				out.push({
					json: {
						...item.json,
						geo: ip
							? (results.get(ip) ?? { ip, found: false, error: 'sin resultado' })
							: { found: false, error: `el item no trae el campo ${ipField}` },
					},
					pairedItem: { item: index },
				});
			});

			return [out];
		}

		// --- Consultas individuales --------------------------------------------
		for (let i = 0; i < items.length; i++) {
			if (operation === 'mine') {
				const data = (await request('?format=json')) as IDataObject;
				out.push({ json: decorate(data), pairedItem: { item: i } });
				continue;
			}

			const query = (this.getNodeParameter('query', i) as string).trim();
			if (!query) {
				throw new NodeOperationError(this.getNode(), 'Falta la IP a consultar', { itemIndex: i });
			}

			const cached = getCached(query);
			if (cached) {
				out.push({ json: cached, pairedItem: { item: i } });
				continue;
			}

			try {
				const data = decorate((await request(encodeURIComponent(query))) as IDataObject);
				if (data.found) setCached(query, data);
				out.push({ json: data, pairedItem: { item: i } });
			} catch (error) {
				// Una IP mal formada devuelve 404 con un cuerpo de texto plano.
				if (this.continueOnFail()) {
					out.push({
						json: { ip: query, found: false, error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(
					this.getNode(),
					`ipquery.io no reconoció la IP "${query}"`,
					{ itemIndex: i },
				);
			}
		}

		return [out];
	}
}
