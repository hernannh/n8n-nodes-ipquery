/**
 * Lint config for an n8n community node package.
 * Uses eslint-plugin-n8n-nodes-base to enforce the marketplace conventions
 * (naming, display names, alphabetical options, credential test, ...).
 */
module.exports = {
	root: true,
	env: { browser: true, es6: true, node: true },
	parser: '@typescript-eslint/parser',
	parserOptions: { sourceType: 'module', extraFileExtensions: ['.json'] },
	ignorePatterns: ['.eslintrc.js', '**/*.js', '**/node_modules/**', '**/dist/**'],
	overrides: [
		{
			files: ['package.json'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/community'],
			rules: {
				'n8n-nodes-base/community-package-json-name-still-default': 'off',
			},
		},
		{
			files: ['./credentials/**/*.ts'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/credentials'],
			rules: {
				// documentationUrl rules are main-repo-only and mutually contradictory
				// for community packages (require it, then mangle a real URL to camelCase).
				'n8n-nodes-base/cred-class-field-documentation-url-missing': 'off',
				'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
				'n8n-nodes-base/cred-class-field-documentation-url-not-http-url': 'off',
			},
		},
		{
			files: ['./nodes/**/*.ts'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/nodes'],
			rules: {
				// UI en español: la regla exige que las descripciones de booleanos
				// empiecen con la palabra inglesa "Whether". No aplica a un producto
				// en español; se desactiva.
				'n8n-nodes-base/node-param-description-boolean-without-whether': 'off',
				// El autofix de sentence-case corrompe caracteres acentuados (UTF-8):
				// 'ubicación' -> 'ubicaci n'. Se desactiva para no romper el español.
				'n8n-nodes-base/node-param-operation-option-action-miscased': 'off',
				// Recursos en español son plurales a propósito (Sesiones, Mensajes, Grupos).
				// La regla exige singular (convención inglesa); no aplica.
				'n8n-nodes-base/node-param-resource-with-plural-option': 'off',
			},
		},
	],
};
