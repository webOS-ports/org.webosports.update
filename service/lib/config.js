// Copyright (c) 2026 Herman van Hazendonk
// Derived from the old service's javascript/config.js, Copyright (c) 2013-2016
// Achim Königs, (c) 2014 Simon Busch, (c) 2019-2023 Herman van Hazendonk,
// licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

/*
	Where the service finds things: the values of the old javascript/config.js,
	unchanged. createConfig(overrides) gives a copy with some of them changed
	(the tests point the files, URLs and commands somewhere else).
*/

const DEFAULTS = {
	manifestUrlTemplate: 'http://build.webos-ports.org/luneos-%%BUILDTREE%%/manifest.json',
	versionFile: '/etc/luneos-release',
	// /etc/luneos-release reads
	// ${BUILD_DISTRIB_ID} release ${DISTRO_VERSION}-${BUILD_TREE}-${WEBOS_DISTRO_BUILD_ID} (${WEBOS_DISTRO_RELEASE_CODENAME})
	// where WEBOS_DISTRO_BUILD_ID is "unofficial" for a local build, and BUILD_TREE the feed's
	// name (stable, testing, unstable; "wrynose" on the VM).
	parseWholeStringRegExp: /([0-9\._\-A-Za-z]+) release ([0-9\.]+)-([A-Za-z\/\-0-9]+)-([A-Za-z\/\-0-9]+) \(([0-9a-zA-Z_\-\.]+)\)/,
	parseWholeStringIndex: 2,
	parseWholeStringBuildTreeIndex: 3,
	parseWholeStringBuildIndex: 4,
	parseWholeStringCodenameIndex: 5,
	parseOnlyPlatformVersionRegExp: /.*?-([0-9]+)-.*?/,

	// The image downloadUpdate fetches, and where it goes.
	downloadPath: '/userdata/luneos-data/',
	downloadFilename: 'system-update.zip',
	// A JSON object {<device name>: {<version>: {url}}}.
	deviceImagesUrlTemplate: 'http://build.webos-ports.org/luneos-%%BUILDTREE%%/device-images.json',

	// initiateUpdate: start-update.sh marks the next boot as a system update and reboots.
	rebootToUpdateModeCommand: {cmd: 'script', args: ['-q', '-c', '/usr/palm/services/org.webosports.service.update/start-update.sh', '/dev/null']},

	// What checkUpdate found, for downloadUpdate.
	checkUpdateResultsFile: '/tmp/checkUpdateResults.json',
	getDeviceNameCommand: {cmd: 'nyx-cmd', args: ['DeviceInfo', 'query', '--format=json']},

	// How long an HTTP GET may take (Foundations' AjaxCall gave 60 s).
	httpTimeoutMs: 60000
};

function buildUrl(template, buildtree) {
	return template.replace('%%BUILDTREE%%', buildtree || 'stable');
}

function createConfig(overrides = {}) {
	const config = Object.assign({}, DEFAULTS, overrides);
	config.getManifestUrl = buildtree => buildUrl(config.manifestUrlTemplate, buildtree);
	config.getDeviceImagesUrl = buildtree => buildUrl(config.deviceImagesUrlTemplate, buildtree);
	return config;
}

module.exports = {createConfig, DEFAULTS};
