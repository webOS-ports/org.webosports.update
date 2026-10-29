// Copyright (c) 2026 Herman van Hazendonk
// SPDX-License-Identifier: Apache-2.0

'use strict';

/*
	The service on a stand-in bus (palmbus.js), with everything it reaches
	stood in for: the bus services it calls (bus, below), the release and
	results files (an in-memory fs), nyx-cmd and script (spawn), and the feed
	(a local HTTP server: feed, below). Nothing on the host is read or
	written, and nothing is run.
*/

const http = require('http');
const path = require('path');
const {EventEmitter} = require('events');
const {createPalmbus} = require('./palmbus');

const SERVICE = path.join(__dirname, '..', 'service');
const NAME = 'org.webosports.service.update';
const VM_RELEASE = 'Rockhopper release 1.0-wrynose-unofficial (luneos-Espressino)\n';
const quiet = {log() {}, warn() {}, error() {}, info() {}};

// fs.promises' readFile and writeFile over files = {path: content}.
function memoryFs(files) {
	const enoent = p => Object.assign(new Error('ENOENT: no such file or directory, open \'' + p + '\''),
		{code: 'ENOENT', errno: -2});
	return {
		readFile: async p => {
			if (!Object.prototype.hasOwnProperty.call(files, p)) {
				throw enoent(p);
			}
			return Buffer.from(files[p]);
		},
		writeFile: async (p, data) => {
			if (p.indexOf('/nodir/') >= 0) {
				throw enoent(p);
			}
			files[p] = String(data);
		}
	};
}

/*
	spawn as child_process has it, for commands = {<cmd>: {out, err, code} |
	'missing'}; each run is recorded in runs as {cmd, args}.
*/
function fakeSpawn(commands, runs) {
	return (cmd, args) => {
		runs.push({cmd, args});
		const c = new EventEmitter();
		c.stdout = new EventEmitter();
		c.stderr = new EventEmitter();
		const how = commands[cmd];
		setImmediate(() => {
			if (!how || how === 'missing') {
				const e = Object.assign(new Error('spawn ' + cmd + ' ENOENT'), {code: 'ENOENT', errno: -2});
				c.emit('error', e);
				c.emit('close', -2);
				return;
			}
			if (how.out) {
				c.stdout.emit('data', Buffer.from(how.out));
			}
			if (how.err) {
				c.stderr.emit('data', Buffer.from(how.err));
			}
			c.emit('close', how.code || 0);
		});
		return c;
	};
}

const MANIFEST = require('./manifest.json');

/*
	bus: {<service/method>: reply | [replies] | (args) => reply}; the
	defaults are a connected device with no preferences set.
	feed: {<path>: {status, body} | {hang: true} | {chunks: [Buffer...]}}.
*/
async function boot({bus = {}, release = VM_RELEASE, files = {}, commands = {}, feed = {}, timeoutS = 2, httpTimeoutMs = 1000,
	config: extra = {}} = {}) {
	const calls = [];
	const runs = [];
	const requests = [];
	const fsFiles = Object.assign({}, files);
	if (release !== null) {
		fsFiles['/etc/luneos-release'] = release;
	}
	const replies = Object.assign({
		'com.webos.service.connectionmanager/getStatus': {returnValue: true, isInternetConnectionAvailable: true},
		'com.webos.service.systemservice/getPreferences': {returnValue: true},
		'com.webos.notification/closeToast': {returnValue: true},
		'com.webos.notification/createToast': {returnValue: true},
		'com.palm.activitymanager/adopt': {returnValue: true, adopted: true},
		'com.palm.activitymanager/monitor': {returnValue: true},
		'com.palm.activitymanager/complete': {returnValue: true}
	}, bus);
	let pending = 0, last = Date.now();
	async function onCall(uri, args) {
		pending++;
		last = Date.now();
		try {
			const [, service, method] = /^(?:luna|palm):\/\/([^/]+)\/(.+)$/.exec(uri);
			calls.push({service, method, args, uri});
			const r = replies[service + '/' + method];
			if (r === undefined) {
				return {returnValue: false, errorCode: -1, errorText: 'unexpected ' + uri};
			}
			return typeof r === 'function' ? r(args) : JSON.parse(JSON.stringify(r));
		} finally {
			pending--;
			last = Date.now();
		}
	}

	const server = http.createServer((req, res) => {
		requests.push(req.url);
		const route = feed[req.url];
		if (!route) {
			res.writeHead(404);
			res.end('not found');
			return;
		}
		if (route.hang) {
			return;
		}
		res.writeHead(route.status || 200, {'Content-Type': 'application/json'});
		if (route.chunks) {
			let i = 0;
			const next = () => {
				if (i < route.chunks.length - 1) {
					res.write(route.chunks[i++]);
					setTimeout(next, 5);
				} else {
					res.end(route.chunks[i]);
				}
			};
			next();
			return;
		}
		res.end(typeof route.body === 'string' ? route.body : JSON.stringify(route.body));
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	const base = 'http://127.0.0.1:' + server.address().port + '/luneos-%%BUILDTREE%%/';

	const pb = createPalmbus(onCall);
	const {start} = require(SERVICE + '/service');
	const config = Object.assign({
		manifestUrlTemplate: base + 'manifest.json',
		deviceImagesUrlTemplate: base + 'device-images.json',
		httpTimeoutMs
	}, extra);
	const service = start({palmbus: pb, idleMs: 0, log: quiet, exit() {}, timeoutS, config,
		fs: memoryFs(fsFiles), spawn: fakeSpawn(Object.assign({'nyx-cmd': {out: '{"device_name": "qemux86-64"}\n'}}, commands), runs)});

	async function settle(ms = 30) {
		for (;;) {
			await new Promise(r => setTimeout(r, 5));
			if (pending === 0 && Date.now() - last >= ms) {
				return;
			}
		}
	}

	// caller: {service} or {appId}. -> the first reply, after the calls it leads to are done.
	async function ask(method, params, caller) {
		const r = pb.request(NAME, method, params || {}, caller);
		const first = await r.first;
		await settle();
		return first;
	}

	// A call left open: -> {first, replies, token}.
	function send(method, params, caller) {
		return pb.request(NAME, method, params || {}, caller);
	}

	return {
		ask, send, settle, calls, runs, requests, pb, service, files: fsFiles,
		callsTo: (name, method) => calls.filter(c => c.service === name && (!method || c.method === method)),
		cancel: token => pb.cancel(NAME, token),
		stop() {
			service.bus.stop();
			server.close();
			server.closeAllConnections();
		}
	};
}

module.exports = {boot, NAME, VM_RELEASE, MANIFEST, quiet, memoryFs, fakeSpawn};
