/*jslint regexp: true */

var Config = {
    manifestUrl: "http://build.webos-ports.org/webos-ports-staging/latest/manifest.json",
    versionFile: "/etc/webos-release",
    //regexp to parse webos-release file. Will return:
    //${BUILD_DISTRIB_ID} release ${DISTRO_VERSION}-${WEBOS_DISTRO_BUILD_ID} (${WEBOS_DISTRO_RELEASE_CODENAME})
    //where ${WEBOS_DISTRO_BUILD_ID} is ${PLATTFORMVERSION}-${BUILD}
    parseWholeStringRegExp: /([0-9\._\-A-Za-z]+) release ([0-9\.]+)-([0-9]+)-([0-9]+) \(([0-9a-zA-Z_\-\.]+)\)/,
    parseWholeStringIndex: 3,
    parseWholeStringCodenameIndex: 5,
    parseOnlyPlattformVersionRegExp: /.*?-([0-9]+)-.*?/,
    preDownloadCommand: {cmd: "opkg", args: ["update"] },
    numPackagesCommand: {cmd: "opkg", args: ["list-upgradable"] },
    //using script here to get line by line output from download command:
    downloadCommand: {cmd: "script", args: ["-q", "-c", "/usr/palm/services/org.webosports.service.update/download-updates.sh", "/dev/null"]},
    downloadPath: "/media/internal/.upgrade-storage", //used to check if path exists
    rebootToUpdateModeCommand: {cmd: "script", args: ["-q", "-c", "/usr/palm/services/org.webosports.service.update/start-update.sh", "/dev/null"]},
    currentVersionFile: "/var/preferences/system-update/current-version",
    forceVersionFile: "/var/preferences/system-update/update-to-version",
    potentialForceVersionFile: "/var/preferences/system-update/available-version"
};
