import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

const BASE_URL = 'https://api.ipquery.io';
/** Per-request cap. The real limit is URL length, not the number of IPs. */
const BATCH_MAX = 200;

interface CacheEntry {
	expiresAt: number;
	data: IDataObject;
}

/**
 * IPQuery - IP geolocation and enrichment through ipquery.io.
 *
 * No API key and served over HTTPS, which is the practical difference with the
 * free ip-api endpoint (plain HTTP). Bulk lookups carry the addresses in the URL
 * itself, comma separated.
 *
 * Do not take security decisions from the risk flags. Checked against two known
 * Tor exit relays (185.220.101.1 and 171.25.193.25, July 2026) ipquery answers
 * is_tor false, is_proxy false and risk_score 0, while ip-api flags both as
 * proxy. The is_datacenter flag does agree with ip-api's hosting. Use ipquery
 * for geolocation, ASN/ISP and datacenter detection, and a different source for
 * reputation.
 */
export class IpQuery implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IPQuery',
		name: 'ipQuery',
		icon: 'file:ipQuery.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Look up IP geolocation and network data with ipquery.io',
		defaults: { name: 'IPQuery' },
		inputs: ['main'],
		outputs: ['main'],
		usableAsTool: true,
		credentials: [],
		properties: [
			{
				displayName:
					'ipquery.io needs no API key and answers over HTTPS. Its risk flags (proxy/VPN/Tor) are unreliable: in tests against known Tor exit relays it reported is_tor false. Use ip-api for reputation; use this for geolocation, ASN/ISP and datacenter detection.',
				name: 'accuracyNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'lookup',
				options: [
					{
						name: 'Look Up IP',
						value: 'lookup',
						action: 'Look up an IP',
						description: 'Geolocate a single IPv4 or IPv6 address',
					},
					{
						name: 'Look Up Many (Bulk)',
						value: 'batch',
						action: 'Look up many addresses in bulk',
						description: 'Take the IP from every input item and look many up per request, comma-separated in the URL',
					},
					{
						name: 'Look Up Own IP',
						value: 'mine',
						action: 'Look up own IP',
						description: 'Return data about the public IP this n8n instance goes out with',
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
				description: 'IPv4 or IPv6 address to look up. This service does not accept domain names.',
			},
			{
				displayName: 'Field With the IP',
				name: 'ipField',
				type: 'string',
				default: 'ip',
				required: true,
				placeholder: 'data.srcip',
				displayOptions: { show: { operation: ['batch'] } },
				description:
					'Name of the field in each item holding the IP. Dot notation works for nested fields, for example data.srcip in a Wazuh alert.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Batch Size',
						name: 'batchSize',
						type: 'number',
						default: 100,
						typeOptions: { minValue: 1, maxValue: BATCH_MAX },
						description:
							'How many IPs to request at once. The real limit is URL length rather than count: 300 IPv4 addresses are about 2800 characters.',
					},
					{
						displayName: 'Cache TTL (Seconds)',
						name: 'cacheTtl',
						type: 'number',
						default: 3600,
						typeOptions: { minValue: 0 },
						description:
							'How long an already resolved IP is reused within this workflow. Set to 0 to disable the cache.',
					},
					{
						displayName: 'Flatten Result',
						name: 'flatten',
						type: 'boolean',
						default: false,
						description:
							'Whether to return a flat object (country, city, asn, isDatacenter and so on) instead of the nested API shape. Makes it easier to compare against other providers.',
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
		 * A private or reserved address answers HTTP 200 with empty fields and junk
		 * coordinates near (0,0) instead of an error. Go past that and the workflow
		 * takes it for a real location and points at null island, so mark it with
		 * found false.
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

		// --- Bulk lookup --------------------------------------------------------
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
				// A single address answers with an object rather than an array.
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
							? (results.get(ip) ?? { ip, found: false, error: 'no result' })
							: { found: false, error: `item has no ${ipField} field` },
					},
					pairedItem: { item: index },
				});
			});

			return [out];
		}

		// --- Single lookups -----------------------------------------------------
		for (let i = 0; i < items.length; i++) {
			if (operation === 'mine') {
				const data = (await request('?format=json')) as IDataObject;
				out.push({ json: decorate(data), pairedItem: { item: i } });
				continue;
			}

			const query = (this.getNodeParameter('query', i) as string).trim();
			if (!query) {
				throw new NodeOperationError(this.getNode(), 'No IP address to look up', { itemIndex: i });
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
				// A malformed address answers 404 with a plain text body.
				if (this.continueOnFail()) {
					out.push({
						json: { ip: query, found: false, error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), `ipquery.io did not accept the IP "${query}"`, {
					itemIndex: i,
				});
			}
		}

		return [out];
	}
}
