// Copyright (c) 2026 Herman van Hazendonk
// Derived from the old service's javascript/assistants/*.js, utils/utils.js
// and utils/activities.js, Copyright (c) 2013-2016 Achim Königs, (c) 2014 Simon
// Busch, (c) 2015-2024 Herman van Hazendonk, and Foundations' control/future.js,
// Copyright (c) 2009-2012 Hewlett-Packard Development Company, L.P., licensed
// under the Apache License, Version 2.0.
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

/*
	The four commands, as the old assistants (javascript/assistants/*.js) ran
	them, step by step. Each step there was a Foundations future: a step that
	threw handed its error to the next one, which saw {returnValue:false,
	exception}; a step that answered with an error ended the chain. That is
	kept: settle() turns what a step throws into what the next one sees.

	The old service's bugs are kept here as they were; README.md lists them
	(B1, B2, ...) and the commits after the rewrite mend them one at a time.
*/

const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const fsModule = require('fs');

// The SHA-256 of a file, read as a stream (an image is hundreds of megabytes): hex, lower case.
function sha256File(file) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		fsModule.createReadStream(file)
			.on('error', reject)
			.on('data', chunk => hash.update(chunk))
			.on('end', () => resolve(hash.digest('hex')));
	});
}

/*
	An image entry of device-images.json, {url, sha256}, that may be fetched:
	the URL https, so that what is fetched is what the feed's host sent, and a
	SHA-256 to hold the file to once it is here. Without the hash, anyone who
	could answer for the image's host, or a redirect from it (the
	downloadmanager follows them, to http too), would choose what the device
	installs.
*/
function checkImage(entry) {
	if (!entry || typeof entry.url !== 'string' || typeof entry.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(entry.sha256)) {
		return false;
	}
	try {
		return new URL(entry.url).protocol === 'https:';
	} catch (e) {
		return false;
	}
}

const SERVICE = 'org.webosports.service.update';
const ACTIVITY_NAME = 'org.webosports.service.update: Periodic Update Check';
const CONNECTION_MANAGER = 'luna://com.webos.service.connectionmanager';
const SYSTEM_SERVICE = 'luna://com.webos.service.systemservice/';
const NOTIFICATION = 'luna://com.webos.notification';
const DOWNLOAD_MANAGER = 'luna://com.webos.service.downloadmanager';
// The QML Settings app's System Updates page: each category of that app is an application of its
// own. The Enyo app this used to open (org.webosports.app.settings, page "SystemUpdates") is in no
// image any more.
const SETTINGS_APP = 'org.webosports.app.settings.updates';
const ICON = '/usr/palm/applications/org.webosports.app.settings.updates/qml/images/icons/icon-updates.png';

// What a step that threw hands to the next: Utils.checkResult's {returnValue:false, exception}.
async function settle(fn) {
	try {
		return await fn();
	} catch (e) {
		return {returnValue: false, exception: e};
	}
}

/*
	parseManifest: the highest version in the manifest's changeLog above
	localVersion that is for this device, and in changes each entry that
	raised the highest seen so far, newest first. Without
	ignorePlatformVersion, versions above the manifest's platformVersion
	are left out.
*/
function parseManifest(manifest, deviceName, ignorePlatformVersion, changes, localVersion, log = console) {
	const platformVersion = manifest.platformVersion;
	let maxVersion = localVersion || -1;
	manifest.changeLog.forEach(entry => {
		if (!ignorePlatformVersion && entry.version > platformVersion) {
			return;
		}
		if (entry.unsupported_devices) {
			let found = false;
			entry.unsupported_devices.forEach(device => {
				if (device === deviceName) {
					found = true;
				}
			});
			if (found) {
				log.log('Ignoring version ' + entry.version + ' for device ' + deviceName);
				return;
			}
		}
		if (entry.version > maxVersion) {
			maxVersion = entry.version;
			changes.push(entry);
		}
	});
	changes.sort((a, b) => b.version - a.version);
	return maxVersion;
}

/*
	The release file: {returnValue, version, codename, buildTree, build}, or
	throws {message, errorCode: -1}. "Rockhopper release 1.0-wrynose-unofficial
	(luneos-Espressino)" gives version "1.0" (a string), buildTree "wrynose",
	build "unofficial", codename "Espressino". A file the full pattern does not
	match is read as "...-<number>-...", version a number, codename what is
	between the last "(" and the last two characters.
*/
function parseRelease(config, dataStr) {
	let matches = config.parseWholeStringRegExp.exec(dataStr) || [];
	let version = matches && matches[config.parseWholeStringIndex], codename;
	if (!version && version !== 0) {
		matches = config.parseOnlyPlatformVersionRegExp.exec(dataStr);
		version = matches && parseInt(matches[1], 10);
		codename = dataStr.substring(dataStr.lastIndexOf('(') + 1, dataStr.length - 2);
	} else {
		codename = matches[config.parseWholeStringCodenameIndex];
	}
	if (!version && version !== 0) {
		throw {message: 'Could not parse version from file: ' + dataStr, errorCode: -1};
	}
	if (codename) {
		codename = codename.substr(codename.indexOf('-') + 1);
		// Nothing after the "-" is no codename; the old code threw on it, in a callback nothing
		// caught, and the service died (README.md, B5).
		if (codename) {
			codename = codename[0].toUpperCase() + codename.substr(1);
		}
	}
	return {
		returnValue: true,
		version,
		codename,
		buildTree: matches[config.parseWholeStringBuildTreeIndex],
		build: matches[config.parseWholeStringBuildIndex]
	};
}

function createUpdate({palm, config, http, child, fs = fsp, hashFile = sha256File, log = console}) {
	async function localVersion() {
		let data;
		try {
			data = await fs.readFile(config.versionFile);
		} catch (e) {
			log.log('Error while reading version file ( ' + config.versionFile + ' ): ' + JSON.stringify(e));
			throw {message: e.message, errorCode: -1};
		}
		const dataStr = data.toString();
		log.log('Got data from file: ' + dataStr);
		return parseRelease(config, dataStr);
	}

	async function writeUpdateResults(results) {
		try {
			// The directory is made if it is not there (/run is empty at each boot), for the service
			// alone; mode is only applied when it is made.
			await fs.mkdir(path.dirname(config.checkUpdateResultsFile), {recursive: true, mode: 0o700});
			await fs.writeFile(config.checkUpdateResultsFile, JSON.stringify(results), {mode: 0o600});
			return {returnValue: true};
		} catch (e) {
			log.log('Could not write checkUpdateResultsFile: ' + JSON.stringify(e));
			return {returnValue: false};
		}
	}

	async function readUpdateResults() {
		let data;
		try {
			data = await fs.readFile(config.checkUpdateResultsFile);
		} catch (e) {
			log.log('Could not read checkUpdateResultsFile: ' + JSON.stringify(e));
			return {returnValue: false, error: e};
		}
		// A file that is not JSON is as good as none: check again. The old code's JSON.parse threw in a
		// callback nothing caught, and the service died (README.md, B6).
		try {
			return {returnValue: true, results: JSON.parse(data)};
		} catch (e) {
			log.log('Could not parse checkUpdateResultsFile: ' + e.message);
			return {returnValue: false, error: e};
		}
	}

	// A JSON file from the feed: {returnValue, <key>: the object}, or throws {message, errorCode}.
	async function getJson(url, key) {
		const result = await http.get(url);
		if (result.status === 200) {
			if (result.responseJSON) {
				return {returnValue: true, [key]: result.responseJSON};
			}
			throw {message: 'No JSON in response.', errorCode: -1};
		}
		throw {message: 'Status code falsy: ' + result.status, errorCode: result.status};
	}

	async function getDeviceName() {
		let data = '', error = '';
		const result = await child.run(config.getDeviceNameCommand, input => {
			if (input.type === 'out') {
				data += input.msg;
			} else {
				error += input.msg;
			}
		});
		try {
			const info = JSON.parse(data);
			if (info.device_name) {
				info.returnValue = true;
				return info;
			}
			throw {message: 'No device name in result: ' + data};
		} catch (e) {
			log.log('JSON parse of ' + data + ' failed.');
			throw {message: 'finished with code ' + result.code + ', error messages: ' + error};
		}
	}

	async function checkUpdate() {
		let ignorePlatformVersion = false, localVer, buildTree, deviceName, manifest, remoteVersion;
		const changesSinceLast = [];
		const fail = (msg, error) => {
			const e = error || {};
			log.log(msg + ': ' + JSON.stringify(e));
			if (typeof e === 'string') {
				msg += ' - ' + e;
			} else if (e.message) {
				msg += ' - ' + e.message;
			}
			return {returnValue: false, success: false, needUpdate: false, message: msg};
		};

		const status = await settle(() => palm.call(CONNECTION_MANAGER, 'getStatus', {subscribe: false}));
		if (!(status.returnValue && status.isInternetConnectionAvailable)) {
			log.log('Connection status: ' + JSON.stringify(status));
			return fail('No internet connection.');
		}

		const prefs = await settle(() => palm.call(SYSTEM_SERVICE, 'getPreferences', {keys: ['updateIgnorePlatformVersion']}));
		if (prefs.returnValue) {
			ignorePlatformVersion = prefs.updateIgnorePlatformVersion;
			if (ignorePlatformVersion) {
				log.log('Configured to get latest cutting edge version.');
			}
		} else {
			log.log('Could not get pref, continue with default value');
		}

		const local = await settle(localVersion);
		log.log('localVersion came back: ' + JSON.stringify(local));
		if (local.returnValue !== true) {
			return fail('Could not get local plattform version.', local.exception);
		}
		buildTree = local.buildTree || 'stable';
		localVer = local.version;

		const device = await settle(getDeviceName);
		if (device.returnValue !== true) {
			return fail('Could not get device name', device.exception);
		}
		deviceName = device.device_name;

		// The manifest, then the step after it, which throws on a manifest of the wrong shape.
		const got = await settle(() => getJson(config.getManifestUrl(buildTree), 'manifest'));
		const written = await settle(() => {
			if (!(got && got.returnValue === true)) {
				return {stop: fail('Could not get manifest', got.exception)};
			}
			manifest = got.manifest;
			remoteVersion = parseManifest(manifest, deviceName, ignorePlatformVersion, changesSinceLast, localVer, log);
			if (!remoteVersion) {
				return {stop: fail('Could not parse remote version from manifest', {message: JSON.stringify(manifest)})};
			}
			return writeUpdateResults({version: remoteVersion, deviceName, buildTree});
		});
		if (written.stop) {
			return written.stop;
		}
		if (!written.returnValue) {
			return fail('Something went wrong in the filesystem.', written.message);
		}

		log.log('Remote version came back: ' + remoteVersion);
		if (remoteVersion > localVer) {
			notify(remoteVersion, changesSinceLast);
			return {returnValue: true, success: true, needUpdate: true, changesSinceLast};
		}
		// A toast from an earlier check offers what is now installed, or what the feed no longer has.
		closeToast();
		return {returnValue: true, success: true, needUpdate: false};
	}

	// The toast is this service's alone, so its sourceId closes it; that there is none is no failure.
	function closeToast() {
		return palm.call(NOTIFICATION, 'closeToast', {sourceId: SERVICE}).catch(() => {});
	}

	// The toast, after the answer: closeToast (whatever it answers), then createToast.
	function notify(remoteVersion, changesSinceLast) {
		closeToast().then(() => {
			return palm.call(NOTIFICATION, 'createToast', {
				sourceId: SERVICE,
				onclick: {appId: SETTINGS_APP, params: {needUpdate: true, changesSinceLast}},
				title: 'System update available',
				message: 'New version ' + remoteVersion,
				iconUrl: ICON
			});
		}).then(r => {
			log.log('ApplicationManager call came back: ' + JSON.stringify(r));
		}, e => {
			log.log('createToast failed: ' + ((e && e.message) || e));
		});
	}

	async function downloadUpdate(params, sub) {
		let updateData;
		const logToApp = result => {
			const status = {percentage: (100 * result.amountReceived / result.amountTotal).toFixed(2)};
			if (isNaN(status.percentage)) {
				return;
			}
			if (sub) {
				sub(status);
			} else {
				log.log('Don\'t have subscription... Would have sended: ' + JSON.stringify(status));
			}
		};
		const fail = (msg, error, needCheck) => {
			let outMsg = msg;
			if (error) {
				outMsg += ':\n' + (error.message || error.msg) + (error.code ? ('\nErrorCode: ' + error.code) : '') +
					(error.errorCode ? ('\nErrorCode: ' + error.errorCode) : '');
			}
			log.log(msg + ': ' + JSON.stringify(error));
			return {success: false, error: true, msg: outMsg, needCheck: !!needCheck};
		};

		// Online as checkUpdate takes it; the old code went by returnValue alone (README.md, B3).
		const status = await settle(() => palm.call(CONNECTION_MANAGER, 'getStatus', {subscribe: false}));
		if (!(status.returnValue && status.isInternetConnectionAvailable)) {
			return fail('No internet connection.');
		}

		const stored = await settle(readUpdateResults);
		// The device images, then the step after them, which throws on stored results that are null.
		const images = await settle(() => {
			if (!stored.returnValue) {
				return {stop: fail('No update data stored, check for update first, please.', false, true)};
			}
			updateData = stored.results;
			return getJson(config.getDeviceImagesUrl(updateData.buildTree), 'deviceImages');
		});
		if (images.stop) {
			return images.stop;
		}
		let url, sha256;
		const step = await settle(() => {
			if (!images.returnValue) {
				return {stop: fail('Could not download device images file from server.')};
			}
			const di = images.deviceImages;
			if (di && di[updateData.deviceName] && di[updateData.deviceName][updateData.version]) {
				const entry = di[updateData.deviceName][updateData.version];
				if (!checkImage(entry)) {
					return {stop: fail('The update server gives no https URL and SHA-256 for this image; it is not downloaded.')};
				}
				url = entry.url;
				sha256 = entry.sha256.toLowerCase();
				log.log('Got url: ' + url);
				return {go: true};
			}
			return {stop: fail('Device images file corrupt or version not present anymore. Please check for updates again.', false, true)};
		});
		if (step.stop) {
			return step.stop;
		}
		if (!step.go) {
			// The step threw: the one after it answered with its error.
			return fail('Error during download', step.exception);
		}

		const result = await new Promise(resolve => {
			let finished = false;
			palm.subscribe(DOWNLOAD_MANAGER, 'download', {
				target: url,
				keepFilenameOnRedirect: true,
				targetFilename: config.downloadFilename,
				targetDir: config.downloadPath,
				subscribe: true
			}, (e, r) => {
				if (finished) {
					return;
				}
				// A failed reply comes as e (lib/mojo.js, failed()). The downloadmanager's progress and
				// completion messages carry no returnValue, so its absence is no failure.
				if (e) {
					finished = true;
					resolve({stop: fail('Error during download', e)});
					return;
				}
				if (!r.aborted && !r.completed && !r.interrupted) {
					logToApp(r);
					return;
				}
				finished = true;
				resolve({done: r});
			});
		});
		if (result.stop) {
			return result.stop;
		}
		const r = result.done;
		if (r.completed && r.completionStatusCode === 200) {
			// Where the downloadmanager put it: it adds a number to the name when the file is there
			// already.
			const file = typeof r.target === 'string' && r.target ? r.target : path.join(config.downloadPath, config.downloadFilename);
			let got;
			try {
				got = await hashFile(file);
			} catch (e) {
				return fail('Could not read the downloaded update', e);
			}
			if (got !== sha256) {
				log.log('SHA-256 of ' + file + ' is ' + got + ', the feed says ' + sha256);
				try {
					await fs.unlink(file);
				} catch (e) {
					log.log('Could not remove ' + file + ': ' + JSON.stringify(e));
				}
				return fail('The downloaded update is not the one the update server lists (SHA-256 differs); it was removed.');
			}
			// The toast said an update can be had; it is here now, and Settings says so.
			closeToast();
			return {success: true, finished: true, error: false, msg: 'Done downloading.'};
		}
		return fail('Error during download', r.exception);
	}

	async function initiateUpdate() {
		const result = await child.run(config.rebootToUpdateModeCommand);
		if (result.finished && result.error === false) {
			log.log('Log initiated reboot sucessfully.');
			return {success: true, error: false};
		}
		// The old handleError read result.exception.message, which is never there: it threw, and
		// nothing answered until the command timed out (README.md, B4). Its answer is given, with
		// what went wrong as its message.
		const msg = result.errorObj ? result.errorObj.message : config.rebootToUpdateModeCommand.cmd + ' exited with code ' + result.code;
		log.log('Error during initiating update: ' + msg);
		return {returnValue: false, success: false, error: true, msg};
	}

	async function retrieveVersion() {
		const local = await settle(localVersion);
		if (local.returnValue === true) {
			return {
				returnValue: true,
				localVersion: local.version,
				codename: local.codename,
				buildTree: local.buildTree,
				buildNumber: local.build
			};
		}
		const e = local.exception || {};
		let msg = 'Could not get local plattform version';
		log.log(msg + ': ' + JSON.stringify(e));
		if (typeof e === 'string') {
			msg += ' - ' + e;
		} else if (e.message) {
			msg += ' - ' + e.message;
		}
		return {returnValue: false, success: false, needUpdate: false, message: msg};
	}

	// checkUpdate lets go of its activity as the old assistant's complete() meant to: the periodic
	// one is restarted, so that activitymanager runs it again after its interval. The old code took
	// the name from Foundations' Activity, which calls an adopted one "ActivityManager activity<id>",
	// so it never restarted it (README.md, B2); the name activitymanager sends in $activity is used.
	function completeCheck(activity, params) {
		const restart = !!(params && params.$activity && params.$activity.name === ACTIVITY_NAME);
		log.log('Completing activity ' + activity.name);
		return activity.complete(restart);
	}

	return {checkUpdate, downloadUpdate, initiateUpdate, retrieveVersion, completeCheck};
}

module.exports = {createUpdate, parseManifest, parseRelease, checkImage, sha256File, SERVICE, ACTIVITY_NAME};
