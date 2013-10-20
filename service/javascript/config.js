/*jslint regexp: true */

var Config = {
	manifestUrl: "http://build.webos-ports.org/webos-ports-staging/latest/manifest.json",
	versionFile: "/etc/webos-release",
	//regexp to parse webos-release file. Will return:
	//${BUILD_DISTRIB_ID} release ${DISTRO_VERSION}-${WEBOS_DISTRO_BUILD_ID} (${WEBOS_DISTRO_RELEASE_CODENAME})
	//where ${WEBOS_DISTRO_BUILD_ID} is ${PLATTFORMVERSION}-${BUILD}
	//this probably is a little brittle, but would give all the information:
	//issue is with not expected characters in any of the unimportant parts
	parseWholeStringRegExp: /([0-9\._\-A-Za-z]+) release ([0-9\.]+)-([0-9]+)-([0-9]+) \(([0-9a-zA-Z_\-\.]+)\)/,
	parseWholeStringIndex: 3,
	parseOnlyPlattformVersionRegExp: /.*?-([0-9]+)-.*?/,
	preDowlonloadCommand: "opkg update",
	downloadCommand: "opkg upgrade --download-only --cache /media/internal/.upgrade-storage"
};
