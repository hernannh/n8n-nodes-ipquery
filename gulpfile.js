const path = require('path');
const { existsSync } = require('fs');
const { src, dest } = require('gulp');

// Copy the node and credential icons to dist, keeping the folder layout, so that
// n8n can resolve `icon: 'file:...'` at runtime.
//
// `allowEmpty` covers a glob that matches nothing, but not a directory that does
// not exist: gulp throws ENOENT on the scandir. Guard the credentials folder so
// the same gulpfile works in a package that ships none.
function buildIcons() {
	const nodeSource = path.resolve('nodes', '**', '*.{png,svg}');
	const nodeDestination = path.resolve('dist', 'nodes');
	const nodes = src(nodeSource).pipe(dest(nodeDestination));

	if (!existsSync(path.resolve('credentials'))) return nodes;

	const credSource = path.resolve('credentials', '**', '*.{png,svg}');
	const credDestination = path.resolve('dist', 'credentials');
	return src(credSource, { allowEmpty: true }).pipe(dest(credDestination));
}

exports['build:icons'] = buildIcons;
