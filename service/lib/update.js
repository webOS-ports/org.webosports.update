// Copyright (c) 2026 Herman van Hazendonk
// SPDX-License-Identifier: Apache-2.0

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

const SERVICE = 'org.webosports.service.update';
const ACTIVITY_NAME = 'org.webosports.service.update: Periodic Update Check';
const CONNECTION_MANAGER = 'luna://com.webos.service.connectionmanager';
const SYSTEM_SERVICE = 'luna://com.webos.service.systemservice/';
const NOTIFICATION = 'luna://com.webos.notification';
const DOWNLOAD_MANAGER = 'luna://com.webos.service.downloadmanager';
const SETTINGS_APP = 'org.webosports.app.settings';
const ICON = '/usr/palm/applications/org.webosports.app.settings/assets/icons/icon-update.png';

// What a step that threw hands to the next: Utils.checkResult's {returnValue:false, exception}.
async function settle(fn) {
	try {
		return await fn();
	} catch (e) {
		return {returnValue: false, exception: e};
	}
}

// A step that ends the chain without an answer: the old code threw where nothing caught it.
const never = () => new Promise(() => {});

// The old service died here: an exception in a callback nothing caught (README.md, B5, B6).
function crash(e) {
	setImmediate(() => {
		throw e;
	});
	return never();
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
		// "" here throws, as it did (README.md, B5).
		codename = codename[0].toUpperCase() + codename.substr(1);
	}
	return {
		returnValue: true,
		version,
		codename,
		buildTree: matches[config.parseWholeStringBuildTreeIndex],
		build: matches[config.parseWholeStringBuildIndex]
	};
}

function createUpdate({palm, config, http, child, fs = fsp, log = console}) {
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
		try {
			return parseRelease(config, dataStr);
		} catch (e) {
			if (e instanceof TypeError) {
				return crash(e);
			}
			throw e;
		}
	}

	async function writeUpdateResults(results) {
		try {
			await fs.writeFile(config.checkUpdateResultsFile, JSON.stringify(results));
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
		try {
			return {returnValue: true, results: JSON.parse(data)};
		} catch (e) {
			// README.md, B6.
			return crash(e);
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
		return {returnValue: true, success: true, needUpdate: false};
	}

	// The toast, after the answer: closeToast (whatever it answers), then createToast.
	function notify(remoteVersion, changesSinceLast) {
		palm.call(NOTIFICATION, 'closeToast', {sourceId: SERVICE}).catch(() => {}).then(() => {
			return palm.call(NOTIFICATION, 'createToast', {
				sourceId: SERVICE,
				onclick: {appId: SETTINGS_APP, params: {page: 'SystemUpdates', needUpdate: true, changesSinceLast}},
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
		let url;
		const step = await settle(() => {
			if (!images.returnValue) {
				return {stop: fail('Could not download device images file from server.')};
			}
			const di = images.deviceImages;
			if (di && di[updateData.deviceName] && di[updateData.deviceName][updateData.version]) {
				url = di[updateData.deviceName][updateData.version].url;
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
				const one = e ? {returnValue: false, exception: e} : r;
				if (one.returnValue) {
					if (!one.aborted && !one.completed && !one.interrupted) {
						logToApp(one);
						return;
					}
					finished = true;
					resolve({done: one});
					return;
				}
				finished = true;
				resolve({stop: fail('Error during download', one.exception)});
			});
		});
		if (result.stop) {
			return result.stop;
		}
		const r = result.done;
		if (r.returnValue && r.completed && r.completionStatusCode === 200) {
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

module.exports = {createUpdate, parseManifest, parseRelease, SERVICE, ACTIVITY_NAME};
