#!/usr/bin/env node
/**
 * Smoke test against the live ipquery.io service.
 *
 * Usage: node tools/smoke.mjs
 */

const results = [];
const check = (name, ok, detail) => {
	results.push(ok);
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const j1 = await (await fetch('https://api.ipquery.io/8.8.8.8')).json();
check('single lookup', j1.location.country_code === 'US', `${j1.isp.org} / ${j1.location.city}`);
check('returns ASN', /^AS\d+/.test(j1.isp.asn), j1.isp.asn);
check('returns risk flags', typeof j1.risk.is_datacenter === 'boolean',
	`datacenter=${j1.risk.is_datacenter} tor=${j1.risk.is_tor}`);

const j2 = await (await fetch('https://api.ipquery.io/8.8.8.8,1.1.1.1,9.9.9.9')).json();
check('bulk returns an ordered array',
	Array.isArray(j2) && j2[0].ip === '8.8.8.8' && j2[2].ip === '9.9.9.9',
	`${j2.length} results in a single request`);

const j3 = await (await fetch('https://api.ipquery.io/192.168.1.1')).json();
check('private IP answers 200 with empty fields, which the node must detect',
	j3.location.country === '' && j3.isp.asn === 'AS0', 'empty country and AS0');

const r4 = await fetch('https://api.ipquery.io/notanip');
check('malformed address answers 404', r4.status === 404, `HTTP ${r4.status}`);

const j5 = await (await fetch('https://api.ipquery.io/2001:4860:4860::8888')).json();
check('accepts IPv6', j5.isp.asn === 'AS15169', j5.isp.org);

const j6 = await (await fetch('https://api.ipquery.io/?format=json')).json();
check('own IP lookup', typeof j6.ip === 'string' && j6.ip.length > 0,
	`${j6.ip} / ${j6.location.country}`);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
