/*jslint regexp: true, node: true */

var Config = {
    manifestUrlTemplate: "http://build.webos-ports.org/luneos-%%BUILDTREE%%/manifest.json",
    versionFile: "/etc/luneos-release",
    //regexp to parse webos-release file. Will return:
    //${BUILD_DISTRIB_ID} release ${DISTRO_VERSION}-${BUILD_TREE}-${WEBOS_DISTRO_BUILD_ID} (${WEBOS_DISTRO_RELEASE_CODENAME})
    //where ${WEBOS_DISTRO_BUILD_ID} is ${PLATTFORMVERSION}-${BUILD}
    //and BUILD_TREE is one of stable, testing, unstable.
    parseWholeStringRegExp: /([0-9\._\-A-Za-z]+) release ([0-9\.]+)-([A-Za-z]+)-([0-9]+)-([0-9]+) \(([0-9a-zA-Z_\-\.]+)\)/,
    parseWholeStringIndex: 4,
    parseWholeStringBuildTreeIndex: 3,
    parseWholeStringBuildIndex: 5,
    parseWholeStringCodenameIndex: 6,
    parseOnlyPlattformVersionRegExp: /.*?-([0-9]+)-.*?/,
    preDownloadCommand: {cmd: "opkg", args: ["update"] },
    numPackagesCommand: {cmd: "opkg", args: ["list-upgradable"] },
    //using script here to get line by line output from download command:
    downloadCommand: {cmd: "script", args: ["-q", "-c", "/usr/palm/services/org.webosports.service.update/download-updates.sh", "/dev/null"]},
    downloadPath: "/media/internal/.upgrade-storage", //used to check if path exists
    rebootToUpdateModeCommand: {cmd: "script", args: ["-q", "-c", "/usr/palm/services/org.webosports.service.update/start-update.sh", "/dev/null"]},
    preferencesDir: "/var/preferences/system-update/",

    //misc stuff
    checkUpdateResultsFile: "/tmp/checkUpdateResults.json",
    getDeviceNameCommand: {cmd: "nyx-cmd", args: ["DeviceInfo", "query", "--format=json"] },


    getManifestUrl: function (buildtree) {
        "use strict";
        if (!buildtree) {
            buildtree = "stable";
        }
        console.log("BUILDING URL with " + buildtree);
        return Config.manifestUrlTemplate.replace("%%BUILDTREE%%", buildtree);
    }
};

Config.forceVersionFile          = Config.preferencesDir + "update-to-version";
Config.potentialForceVersionFile = Config.preferencesDir + "available-version";

module.exports = Config;
