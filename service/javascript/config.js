/*jslint regexp: true, node: true, nomen: true */

var Config = {
    manifestUrlTemplate: "http://build.webos-ports.org/luneos-%%BUILDTREE%%/manifest.json",
    versionFile: "/etc/luneos-release",
    //regexp to parse webos-release file. Will return:
    //${BUILD_DISTRIB_ID} release ${DISTRO_VERSION}-${BUILD_TREE}-${WEBOS_DISTRO_BUILD_ID} (${WEBOS_DISTRO_RELEASE_CODENAME})
    //where ${WEBOS_DISTRO_BUILD_ID} is ${PLATFORMVERSION}-${BUILD}
    //and BUILD_TREE is one of stable, testing, unstable.
    parseWholeStringRegExp: /([0-9\._\-A-Za-z]+) release ([0-9\.]+)-([A-Za-z\/\-0-9]+)-([0-9]+)-([0-9]+) \(([0-9a-zA-Z_\-\.]+)\)/,
    parseWholeStringIndex: 4,
    parseWholeStringBuildTreeIndex: 3,
    parseWholeStringBuildIndex: 5,
    parseWholeStringCodenameIndex: 6,
    parseOnlyPlatformVersionRegExp: /.*?-([0-9]+)-.*?/,

    //download image:
    downloadPath: "/userdata/luneos-data/",
    downloadFilename: "system-update.zip",
    deviceImagesUrlTemplate: "http://build.webos-ports.org/luneos-%%BUILDTREE%%/device-images.json", //a json that contains the urls of the images to download

    //install update
    rebootToUpdateModeCommand: {cmd: "script", args: ["-q", "-c", "/usr/palm/services/org.webosports.service.update/start-update.sh", "/dev/null"]},

    //misc stuff
    checkUpdateResultsFile: "/tmp/checkUpdateResults.json",
    getDeviceNameCommand: {cmd: "nyx-cmd", args: ["DeviceInfo", "query", "--format=json"] },

    _buildUrl: function (template, buildtree) {
        "use strict";
        if (!buildtree) {
            buildtree = "stable";
        }
        return template.replace("%%BUILDTREE%%", buildtree);
    },
    getManifestUrl: function (buildtree) {
        "use strict";
        return Config._buildUrl(Config.manifestUrlTemplate, buildtree);
    },
    getDeviceImagesUrl: function (buildtree) {
        "use strict";
        return Config._buildUrl(Config.deviceImagesUrlTemplate, buildtree);
    }
};

module.exports = Config;
