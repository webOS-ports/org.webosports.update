// Copyright (c) 2026 Herman van Hazendonk
// SPDX-License-Identifier: Apache-2.0

'use strict';

/*
	The parts that decide: the manifest (the old tests/manifest-parsing.js,
	whose cases are kept here), the release file, and the HTTP GET.
*/

const {describe, it} = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const {parseManifest, parseRelease} = require('../service/lib/update');
const {createConfig} = require('../service/lib/config');
const {createHttp} = require('../service/lib/http');
const {MANIFEST, quiet} = require('./boot');

const versions = changes => changes.map(c => c.version);

describe('parseManifest (the old tests/manifest-parsing.js)', () => {
	it('mako at 23, within the platform version: 24', () => {
		const changes = [];
		assert.equal(parseManifest(MANIFEST, 'mako', false, changes, 23, quiet), 24);
		assert.deepEqual(versions(changes), [24]);
	});
	it('maguro at 23: 24 is not for it, so nothing', () => {
		const changes = [];
		assert.equal(parseManifest(MANIFEST, 'maguro', false, changes, 23, quiet), 23);
		assert.deepEqual(changes, []);
	});
	it('maguro at 23, ignoring the platform version: 29, from 25, 26 and 29', () => {
		const changes = [];
		assert.equal(parseManifest(MANIFEST, 'maguro', true, changes, 23, quiet), 29);
		assert.deepEqual(versions(changes), [29, 26, 25]);
	});
	it('mako at 23, ignoring the platform version: 30, all of 24-30', () => {
		const changes = [];
		assert.equal(parseManifest(MANIFEST, 'mako', true, changes, 23, quiet), 30);
		assert.deepEqual(versions(changes), [30, 29, 28, 27, 26, 25, 24]);
	});
	it('the VM\'s "1.0" compares as a number with the manifest\'s versions', () => {
		const changes = [];
		assert.equal(parseManifest(MANIFEST, 'qemux86-64', false, changes, '1.0', quiet), 24);
		assert.equal(changes.length, 23);
	});
});

describe('the release file', () => {
	const config = createConfig();
	it('reads the VM\'s', () => {
		assert.deepEqual(parseRelease(config, 'Rockhopper release 1.0-wrynose-unofficial (luneos-Espressino)\n'),
			{returnValue: true, version: '1.0', codename: 'Espressino', buildTree: 'wrynose', build: 'unofficial'});
	});
	it('falls back to "-<number>-", the codename between "(" and the last two characters', () => {
		assert.deepEqual(parseRelease(config, 'LuneOS-unstable-23-xyz (luneos-foo)\n'),
			{returnValue: true, version: 23, codename: 'Foo', buildTree: undefined, build: undefined});
	});
	it('throws {message, errorCode: -1} on one it cannot read', () => {
		assert.throws(() => parseRelease(config, 'garbage\n'), {message: 'Could not parse version from file: garbage\n', errorCode: -1});
	});
});

describe('the HTTP GET', () => {
	async function serve(handler, fn) {
		const server = http.createServer(handler);
		await new Promise(r => server.listen(0, '127.0.0.1', r));
		try {
			return await fn('http://127.0.0.1:' + server.address().port);
		} finally {
			server.closeAllConnections();
			server.close();
		}
	}
	it('gives any status as a result, the body parsed when it is JSON, and follows no redirect', async () => {
		await serve((req, res) => {
			if (req.url === '/a') {
				res.writeHead(200);
				res.end('{"x": 1}');
			} else {
				res.writeHead(301, {Location: '/a'});
				res.end('moved');
			}
		}, async base => {
			const get = createHttp().get;
			const a = await get(base + '/a');
			assert.equal(a.status, 200);
			assert.deepEqual(a.responseJSON, {x: 1});
			const b = await get(base + '/b');
			assert.equal(b.status, 301);
			assert.equal(b.responseJSON, undefined);
			assert.equal(b.responseText, 'moved');
		});
	});
	it('fails as AjaxCall did: no connection, and no answer in time (504)', async () => {
		const get = createHttp({timeoutMs: 200}).get;
		const port = await serve(() => {}, async base => {
			await assert.rejects(get(base + '/hang'), {message: 'Timeout received from ajaxCall ', errorCode: 504});
			return new URL(base).port;
		});
		await assert.rejects(get('http://127.0.0.1:' + port + '/x'),
			e => /^httpRequest error connect ECONNREFUSED/.test(e.message) && e.errorCode === -111);
	});
});
