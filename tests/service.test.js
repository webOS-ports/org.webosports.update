// Copyright (c) 2026 Herman van Hazendonk
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

/*
	The service end to end on a stand-in bus: the four commands, the replies
	the mojoservice service gave (an A/B of the two is how they were found;
	see README.md), the activity a call brings, and subscriptions.
*/

const {describe, it} = require('node:test');
const assert = require('node:assert/strict');
const {boot, NAME, MANIFEST} = require('./boot');

const AM = {service: 'com.webos.service.activitymanager'};
const PERIODIC = 'org.webosports.service.update: Periodic Update Check';
const BOOT = 'org.webosports.service.update: Boot Update Check';
const SMALL = {manifestVersion: 2, platformVersion: 26, changeLog: [
	{version: 24, changes: ['a']}, {version: 25, changes: ['b'], unsupported_devices: ['mako']}, {version: 26, changes: ['c']}]};
// What the downloadmanager stand-in "downloads": the file is there when it says it is done.
const IMAGE_FILE = '/userdata/luneos-data/system-update.zip';
const IMAGE_SHA256 = '6b3cf57c7b136ef3ebfab4e4a24a0fd4241f4fb43e6bedebb624375dcd3d1332'; // of "IMAGE"
const IMAGES = {'qemux86-64': {26: {url: 'https://images.example/qemux86-64-26.zip', sha256: IMAGE_SHA256}}};
const STORED = JSON.stringify({version: 26, deviceName: 'qemux86-64', buildTree: 'wrynose'});
const feed = (manifest = SMALL, images = IMAGES, tree = 'wrynose') => ({
	['/luneos-' + tree + '/manifest.json']: {status: 200, body: manifest},
	['/luneos-' + tree + '/device-images.json']: {status: 200, body: images}
});
const RESULTS = '/run/org.webosports.service.update/checkUpdateResults.json';

describe('the update service', () => {
	it('registers the four methods of the old service', async () => {
		const env = await boot();
		const methods = env.pb.services[NAME].methods.map(m => m.replace(/^\//, ''));
		for (const m of ['checkUpdate', 'downloadUpdate', 'initiateUpdate', 'retrieveVersion']) {
			assert.ok(methods.includes(m), m);
		}
		env.stop();
	});

	it('retrieveVersion reads the release file', async () => {
		const env = await boot();
		assert.deepEqual(await env.ask('retrieveVersion'),
			{returnValue: true, localVersion: '1.0', codename: 'Espressino', buildTree: 'wrynose', buildNumber: 'unofficial'});
		env.stop();
	});

	it('retrieveVersion without a release file says why, with returnValue false (B1)', async () => {
		const env = await boot({release: null});
		assert.deepEqual(await env.ask('retrieveVersion'), {returnValue: false, success: false, needUpdate: false,
			message: 'Could not get local plattform version - ENOENT: no such file or directory, open \'/etc/luneos-release\''});
		env.stop();
	});

	it('retrieveVersion and checkUpdate on a release file with an empty codename answer (B5)', async () => {
		const env = await boot({feed: feed(), release: 'webOS-ports release 1.0-wrynose-unofficial (luneos-)\n'});
		assert.deepEqual(await env.ask('retrieveVersion'),
			{returnValue: true, localVersion: '1.0', codename: '', buildTree: 'wrynose', buildNumber: 'unofficial'});
		assert.equal((await env.ask('checkUpdate')).needUpdate, true);
		env.stop();
	});

	it('checkUpdate finds a newer version, writes it down for downloadUpdate and shows a toast', async () => {
		const env = await boot({feed: feed()});
		const r = await env.ask('checkUpdate');
		assert.deepEqual(r, {returnValue: true, success: true, needUpdate: true, changesSinceLast: [SMALL.changeLog[2],
			SMALL.changeLog[1], SMALL.changeLog[0]]});
		assert.deepEqual(JSON.parse(env.files[RESULTS]), {version: 26, deviceName: 'qemux86-64', buildTree: 'wrynose'});
		assert.deepEqual(env.requests, ['/luneos-wrynose/manifest.json']);
		const toasts = env.callsTo('com.webos.notification');
		assert.deepEqual(toasts.map(c => c.method), ['closeToast', 'createToast']);
		assert.equal(toasts[1].args.message, 'New version 26');
		assert.deepEqual(toasts[1].args.onclick, {appId: 'org.webosports.app.settings.updates',
			params: {needUpdate: true, changesSinceLast: r.changesSinceLast}});
		env.stop();
	});

	it('checkUpdate keeps its results out of /tmp, in a directory and file for root alone', async () => {
		const env = await boot({feed: feed()});
		assert.equal((await env.ask('checkUpdate')).needUpdate, true);
		assert.deepEqual(Object.keys(env.files).filter(p => p.startsWith('/tmp/')), []);
		assert.deepEqual(env.dirs['/run/org.webosports.service.update'], {mode: 0o700});
		assert.equal(env.modes[RESULTS], 0o600);
		env.stop();
	});

	it('checkUpdate leaves out what is above the platform version or not for this device', async () => {
		const env = await boot({feed: feed(MANIFEST, IMAGES, 'stable'), release: 'LuneOS release 23-stable-5 (luneos-x)\n',
			commands: {'nyx-cmd': {out: '{"device_name": "maguro"}'}}});
		assert.deepEqual(await env.ask('checkUpdate'), {returnValue: true, success: true, needUpdate: false});
		assert.deepEqual(JSON.parse(env.files[RESULTS]), {version: '23', deviceName: 'maguro', buildTree: 'stable'});
		// No toast, and one an earlier check left behind is closed.
		assert.deepEqual(env.callsTo('com.webos.notification').map(c => [c.method, c.args]),
			[['closeToast', {sourceId: 'org.webosports.service.update'}]]);
		env.stop();
	});

	it('checkUpdate on a release file with no build tree asks the stable feed', async () => {
		const env = await boot({feed: feed(SMALL, IMAGES, 'stable'), release: 'LuneOS-unstable-23-xyz (luneos-foo)\n'});
		const r = await env.ask('checkUpdate');
		assert.deepEqual(env.requests, ['/luneos-stable/manifest.json']);
		assert.equal(r.needUpdate, true);
		assert.equal(JSON.parse(env.files[RESULTS]).buildTree, 'stable');
		env.stop();
	});

	it('checkUpdate with updateIgnorePlatformVersion goes past the platform version', async () => {
		const env = await boot({feed: feed(MANIFEST, IMAGES, 'stable'), release: 'LuneOS release 23-stable-5 (luneos-x)\n',
			commands: {'nyx-cmd': {out: '{"device_name": "maguro"}'}},
			bus: {'com.webos.service.systemservice/getPreferences': {returnValue: true, updateIgnorePlatformVersion: true}}});
		const r = await env.ask('checkUpdate');
		assert.deepEqual(r.changesSinceLast.map(c => c.version), [29, 26, 25]);
		env.stop();
	});

	it('checkUpdate answers its failures with returnValue false (B1)', async () => {
		const cases = [
			[{bus: {'com.webos.service.connectionmanager/getStatus': {returnValue: true, isInternetConnectionAvailable: false}}},
				'No internet connection.'],
			[{release: 'garbage\n'}, 'Could not get local plattform version. - Could not parse version from file: garbage\n'],
			[{commands: {'nyx-cmd': 'missing'}}, 'Could not get device name - finished with code undefined, error messages: '],
			[{commands: {'nyx-cmd': {out: 'x', err: 'oops', code: 1}}}, 'Could not get device name - finished with code 1, error messages: oops'],
			[{}, 'Could not get manifest - Status code falsy: 404'],
			[{feed: {'/luneos-wrynose/manifest.json': {status: 200, body: 'not json'}}}, 'Could not get manifest - No JSON in response.'],
			[{feed: {'/luneos-wrynose/manifest.json': {hang: true}}}, 'Could not get manifest - Timeout received from ajaxCall '],
			[{feed: {'/luneos-wrynose/manifest.json': {status: 200, body: {platformVersion: 3}}}}, 'Something went wrong in the filesystem.'],
			[{feed: feed(), config: {checkUpdateResultsFile: '/nodir/r.json'}}, 'Something went wrong in the filesystem.']
		];
		for (const [opts, message] of cases) {
			const env = await boot(opts);
			assert.deepEqual(await env.ask('checkUpdate'), {returnValue: false, success: false, needUpdate: false, message}, message);
			env.stop();
		}
	});

	it('downloadUpdate downloads the image checkUpdate found, telling a subscriber how far it is', async () => {
		const progress = [
			{returnValue: true, ticket: 3, subscribed: true},
			{returnValue: true, ticket: 3, amountReceived: 250, amountTotal: 1000},
			{returnValue: true, ticket: 3, amountReceived: 1000, amountTotal: 1000, completed: true, completionStatusCode: 200}
		];
		const env = await boot({feed: feed(), bus: {'com.webos.service.downloadmanager/download': progress},
			files: {[RESULTS]: STORED, [IMAGE_FILE]: 'IMAGE'}});
		const r = env.send('downloadUpdate', {subscribe: true});
		await r.first;
		await env.settle();
		assert.deepEqual(r.replies, [
			{percentage: '25.00', returnValue: true, fired: true},
			{success: true, finished: true, error: false, msg: 'Done downloading.', returnValue: true}
		]);
		assert.deepEqual(env.callsTo('com.webos.service.downloadmanager')[0].args, {target: 'https://images.example/qemux86-64-26.zip',
			keepFilenameOnRedirect: true, targetFilename: 'system-update.zip', targetDir: '/userdata/luneos-data/', subscribe: true});
		// The "update available" toast goes once the update is here.
		assert.deepEqual(env.callsTo('com.webos.notification').map(c => [c.method, c.args]),
			[['closeToast', {sourceId: 'org.webosports.service.update'}]]);
		// The subscription stays open after the result, as mojoservice kept it, until its caller cancels it.
		assert.equal(env.service.bus.inflight, 1);
		env.cancel(r.token);
		assert.equal(env.service.bus.inflight, 0);
		env.stop();
	});

	it('downloadUpdate takes the downloadmanager\'s replies as the Sargo sends them, with no returnValue after the first', async () => {
		// luna-send to com.webos.service.downloadmanager/download on the Sargo, 2026-11-05 (some fields left out).
		const sargo = [
			{url: IMAGES['qemux86-64'][26].url, returnValue: true, ticket: 8, target: IMAGE_FILE, subscribed: true},
			{ticket: 8, amountReceived: 15, e_amountReceived: '15', amountTotal: 30, e_amountTotal: '30'},
			{sourceUrl: IMAGES['qemux86-64'][26].url, completed: true, target: IMAGE_FILE, interrupted: false, httpStatus: 200,
				amountTotal: 30, destPath: '/userdata/luneos-data/', aborted: false, destFile: 'system-update.zip', ticket: 8,
				completionStatusCode: 200, amountReceived: 30}
		];
		const env = await boot({feed: feed(), bus: {'com.webos.service.downloadmanager/download': sargo},
			files: {[RESULTS]: STORED, [IMAGE_FILE]: 'IMAGE'}});
		const r = env.send('downloadUpdate', {subscribe: true});
		await r.first;
		await env.settle();
		assert.deepEqual(r.replies, [
			{percentage: '50.00', returnValue: true, fired: true},
			{success: true, finished: true, error: false, msg: 'Done downloading.', returnValue: true}
		]);
		env.cancel(r.token);
		env.stop();
	});

	it('downloadUpdate fetches only an image with an https URL and a SHA-256', async () => {
		const entries = [
			{url: 'http://images.example/qemux86-64-26.zip', sha256: IMAGE_SHA256},
			{url: 'ftp://images.example/qemux86-64-26.zip', sha256: IMAGE_SHA256},
			{url: 'https://images.example/qemux86-64-26.zip'},
			{url: 'https://images.example/qemux86-64-26.zip', sha256: 'abc'},
			{url: 'https://images.example/qemux86-64-26.zip', sha256: IMAGE_SHA256 + '00'},
			{url: 'not a url', sha256: IMAGE_SHA256},
			{sha256: IMAGE_SHA256}
		];
		for (const entry of entries) {
			const env = await boot({feed: feed(SMALL, {'qemux86-64': {26: entry}}), files: {[RESULTS]: STORED, [IMAGE_FILE]: 'IMAGE'}});
			assert.deepEqual(await env.ask('downloadUpdate'), {success: false, error: true, needCheck: false, returnValue: true,
				msg: 'The update server gives no https URL and SHA-256 for this image; it is not downloaded.'}, JSON.stringify(entry));
			assert.equal(env.callsTo('com.webos.service.downloadmanager').length, 0);
			env.stop();
		}
	});

	it('downloadUpdate takes the SHA-256 in either case', async () => {
		const done = {returnValue: true, ticket: 3, completed: true, completionStatusCode: 200};
		const env = await boot({feed: feed(SMALL, {'qemux86-64': {26: {url: IMAGES['qemux86-64'][26].url, sha256: IMAGE_SHA256.toUpperCase()}}}),
			bus: {'com.webos.service.downloadmanager/download': [done]}, files: {[RESULTS]: STORED, [IMAGE_FILE]: 'IMAGE'}});
		assert.equal((await env.ask('downloadUpdate')).success, true);
		env.stop();
	});

	it('downloadUpdate removes a download whose SHA-256 is not the feed\'s, and says so', async () => {
		const done = {returnValue: true, ticket: 3, completed: true, completionStatusCode: 200};
		const env = await boot({feed: feed(), bus: {'com.webos.service.downloadmanager/download': [done]},
			files: {[RESULTS]: STORED, [IMAGE_FILE]: 'NOT THE IMAGE'}});
		assert.deepEqual(await env.ask('downloadUpdate'), {success: false, error: true, needCheck: false, returnValue: true,
			msg: 'The downloaded update is not the one the update server lists (SHA-256 differs); it was removed.'});
		assert.equal(env.files[IMAGE_FILE], undefined);
		// There is still an update to be had, so its toast stays.
		assert.equal(env.callsTo('com.webos.notification').length, 0);
		env.stop();
	});

	it('downloadUpdate checks the file where the downloadmanager says it put it', async () => {
		// It adds a number to the name when the file is there already.
		const other = '/userdata/luneos-data/system-update(1).zip';
		const done = {returnValue: true, ticket: 3, completed: true, completionStatusCode: 200, target: other};
		const env = await boot({feed: feed(), bus: {'com.webos.service.downloadmanager/download': [done]},
			files: {[RESULTS]: STORED, [IMAGE_FILE]: 'IMAGE', [other]: 'TAMPERED'}});
		assert.equal((await env.ask('downloadUpdate')).success, false);
		assert.equal(env.files[other], undefined);
		assert.equal(env.files[IMAGE_FILE], 'IMAGE');
		env.stop();
	});

	it('downloadUpdate fails when the download cannot be read back', async () => {
		const done = {returnValue: true, ticket: 3, completed: true, completionStatusCode: 200};
		const env = await boot({feed: feed(), bus: {'com.webos.service.downloadmanager/download': [done]}, files: {[RESULTS]: STORED}});
		const r = await env.ask('downloadUpdate');
		assert.equal(r.success, false);
		assert.match(r.msg, /^Could not read the downloaded update/);
		env.stop();
	});

	it('downloadUpdate without results to go on asks for a check first', async () => {
		const env = await boot({feed: feed()});
		assert.deepEqual(await env.ask('downloadUpdate'), {success: false, error: true,
			msg: 'No update data stored, check for update first, please.', needCheck: true, returnValue: true});
		env.stop();
	});

	it('downloadUpdate on results with no build tree asks the stable feed', async () => {
		const env = await boot({feed: feed(SMALL, {}, 'stable'), files: {[RESULTS]: JSON.stringify({version: 26, deviceName: 'qemux86-64'})}});
		const r = await env.ask('downloadUpdate');
		assert.deepEqual(env.requests, ['/luneos-stable/device-images.json']);
		assert.equal(r.needCheck, true);
		env.stop();
	});

	it('downloadUpdate on a results file that is not JSON asks for a check first (B6)', async () => {
		const env = await boot({feed: feed(), files: {[RESULTS]: '{'}});
		assert.deepEqual(await env.ask('downloadUpdate', {subscribe: true}), {success: false, error: true,
			msg: 'No update data stored, check for update first, please.', needCheck: true, returnValue: true});
		assert.deepEqual(env.requests, []);
		env.stop();
	});

	it('downloadUpdate passes on a failed download as PalmCall put it', async () => {
		const env = await boot({feed: feed(), bus: {'com.webos.service.downloadmanager/download': {returnValue: false, errorCode: 2, errorText: 'no space'}},
			files: {[RESULTS]: JSON.stringify({version: 26, deviceName: 'qemux86-64', buildTree: 'wrynose'})}});
		const r = await env.ask('downloadUpdate');
		assert.equal(r.msg, 'Error during download:\nluna://com.webos.service.downloadmanager/download ' +
			'{"target":"https://images.example/qemux86-64-26.zip","keepFilenameOnRedirect":true,"targetFilename":"system-update.zip",' +
			'"targetDir":"/userdata/luneos-data/","subscribe":true}: no space\nErrorCode: 2');
		assert.equal(r.success, false);
		env.stop();
	});

	it('initiateUpdate runs start-update.sh through script', async () => {
		const env = await boot({commands: {script: {out: 'ok'}}});
		assert.deepEqual(await env.ask('initiateUpdate'), {success: true, error: false, returnValue: true});
		assert.deepEqual(env.runs.pop(), {cmd: 'script',
			args: ['-q', '-c', '/usr/palm/services/org.webosports.service.update/start-update.sh', '/dev/null']});
		env.stop();
	});

	it('a command still running after its time answers 504, as mojoservice did', async () => {
		const env = await boot({timeoutS: 0.2, bus: {'com.webos.service.connectionmanager/getStatus': () => new Promise(() => {})}});
		const r = await env.ask('checkUpdate');
		assert.equal(r.errorCode, 504);
		assert.equal(r.errorText, 'commandTimeout in org.webosports.service.update/checkUpdate');
		assert.equal(r.returnValue, false);
		env.stop();
	});

	it('an activitymanager callback adopts the activity, answers at once and completes it after', async () => {
		const env = await boot({feed: feed()});
		const r = await env.ask('checkUpdate', {$activity: {activityId: 7, name: 'some activity', callback: {serial: 42}}}, AM);
		assert.deepEqual(r, {returnValue: true});
		const am = env.callsTo('com.palm.activitymanager');
		assert.deepEqual(am.map(c => [c.method, c.args]), [['adopt', {activityId: 7, subscribe: true, serial: 42}],
			['complete', {activityId: 7, serial: 42}]]);
		assert.equal(am[0].uri, 'palm://com.palm.activitymanager/adopt');
		env.stop();
	});

	it('an adopt that fails runs nothing and says so', async () => {
		const env = await boot({bus: {'com.palm.activitymanager/adopt': {returnValue: false, errorCode: 11, errorText: 'busy'}}});
		assert.deepEqual(await env.ask('retrieveVersion', {$activity: {activityId: 7}}, AM), {status: 'adopt failed',
			error: 'Error: palm://com.palm.activitymanager/adopt {"activityId":7,"subscribe":true}: busy', returnValue: true});
		assert.equal(env.calls.length, 1);
		env.stop();
	});

	it('an activity from an app is monitored, not completed', async () => {
		const env = await boot();
		const r = await env.ask('retrieveVersion', {$activity: {activityId: 9}}, {appId: 'org.webosports.app.settings'});
		assert.equal(r.localVersion, '1.0');
		assert.deepEqual(env.callsTo('com.palm.activitymanager').map(c => c.method), ['monitor']);
		env.stop();
	});

	it('the periodic check restarts its activity, so that it runs again (B2)', async () => {
		const env = await boot({feed: feed()});
		await env.ask('checkUpdate', {$activity: {activityId: 5, name: PERIODIC, callback: {serial: 8}}}, AM);
		assert.deepEqual(env.callsTo('com.palm.activitymanager', 'complete')[0].args, {activityId: 5, restart: true, serial: 8});
		// Failed or not, the check is run again.
		const env2 = await boot();
		await env2.ask('checkUpdate', {$activity: {activityId: 6, name: PERIODIC}}, AM);
		assert.deepEqual(env2.callsTo('com.palm.activitymanager', 'complete')[0].args, {activityId: 6, restart: true});
		// Another activity, and the other commands, are completed as they were.
		await env2.ask('retrieveVersion', {$activity: {activityId: 7, name: PERIODIC}}, AM);
		assert.deepEqual(env2.callsTo('com.palm.activitymanager', 'complete')[1].args, {activityId: 7});
		env.stop();
		env2.stop();
	});

	it('the boot check is completed without restart, so that it runs once', async () => {
		const env = await boot({feed: feed()});
		await env.ask('checkUpdate', {$activity: {activityId: 4, name: BOOT, callback: {serial: 3}}}, AM);
		assert.deepEqual(env.callsTo('com.palm.activitymanager', 'complete')[0].args, {activityId: 4, serial: 3});
		env.stop();
	});

	it('initiateUpdate that fails says so at once (B4)', async () => {
		const env = await boot({timeoutS: 5, commands: {script: {code: 1}}});
		const t0 = Date.now();
		assert.deepEqual(await env.ask('initiateUpdate'), {returnValue: false, success: false, error: true, msg: 'script exited with code 1'});
		assert.ok(Date.now() - t0 < 2000);
		env.stop();
		const env2 = await boot({commands: {script: 'missing'}});
		assert.deepEqual(await env2.ask('initiateUpdate'), {returnValue: false, success: false, error: true, msg: 'spawn script ENOENT'});
		env2.stop();
	});

	it('downloadUpdate without the internet says so, and fetches nothing (B3)', async () => {
		const env = await boot({feed: feed(), bus: {'com.webos.service.connectionmanager/getStatus': {returnValue: true, isInternetConnectionAvailable: false}},
			files: {[RESULTS]: JSON.stringify({version: 26, deviceName: 'qemux86-64', buildTree: 'wrynose'})}});
		assert.deepEqual(await env.ask('downloadUpdate'), {success: false, error: true, msg: 'No internet connection.', needCheck: false,
			returnValue: true});
		assert.deepEqual(env.requests, []);
		assert.equal(env.callsTo('com.webos.service.downloadmanager').length, 0);
		env.stop();
	});
});
