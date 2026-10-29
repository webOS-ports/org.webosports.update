// Copyright (c) 2026 Herman van Hazendonk
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

/*
	org.webosports.service.update: checks the LuneOS feed for a newer
	version, tells the user with a toast, downloads the image and reboots into
	the system update.

	The launcher (run-js-service -> jsservicelauncher's bootstrap-node.js)
	requires this directory, as it has a package.json, and calls run().
	Nothing starts on require, so a test can start() it on a stand-in bus.
	The commands are in lib/update.js; lib/mojo.js answers as mojoservice did.
*/

const {createBus} = require('./lib/bus');
const {command, createPalm, DEFAULT_TIMEOUT_S} = require('./lib/mojo');
const {createConfig} = require('./lib/config');
const {createHttp} = require('./lib/http');
const {createChild} = require('./lib/child');
const {createUpdate, SERVICE} = require('./lib/update');

const NAME = SERVICE;
// mojoservice's activityTimeout in the old services.json: leave after 30 s with nothing to do.
const IDLE_MS = 30000;

/*
	start({palmbus, ...}): the service on that bus. config: values to use
	instead of lib/config.js's (files, URLs, commands); timeoutS: a command's
	time (60 s, as mojoservice gave); spawn and fs: stand-ins for the tests.
*/
function start({palmbus, exit, idleMs = IDLE_MS, log = console, config: overrides, timeoutS = DEFAULT_TIMEOUT_S, spawn, fs} = {}) {
	const bus = createBus({palmbus, name: NAME, exit, idleMs, log});
	const palm = createPalm(bus);
	const config = createConfig(overrides);
	const update = createUpdate({
		palm,
		config,
		http: createHttp({timeoutMs: config.httpTimeoutMs}),
		child: createChild({spawn, log}),
		fs,
		log
	});
	const opts = {palm, timeoutS, log};
	bus.serve({
		checkUpdate: command(NAME, 'checkUpdate', () => update.checkUpdate(), Object.assign({complete: update.completeCheck}, opts)),
		downloadUpdate: command(NAME, 'downloadUpdate', (params, sub) => update.downloadUpdate(params, sub),
			Object.assign({subscribe: true}, opts)),
		initiateUpdate: command(NAME, 'initiateUpdate', () => update.initiateUpdate(), opts),
		retrieveVersion: command(NAME, 'retrieveVersion', () => update.retrieveVersion(), opts)
	});
	log.log(NAME + ': up (node ' + process.version + ')');
	return {bus, update, config};
}

let running = null;
function run() {
	if (running) {
		return running;
	}
	process.title = NAME;
	// palmbus is the launcher's: it is there on the device and nowhere else.
	running = start({palmbus: require('palmbus')});
	return running;
}

module.exports = {start, run, NAME};

if (require.main === module) {
	run();
}
