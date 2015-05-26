
var fs = global.fs = require("fs");
var servicePath = global.servicePath = fs.realpathSync(".") + "/../service";

var CheckUpdateAssistant = require(servicePath + "/javascript/assistants/checkUpdateAssistant.js"),
    checkUpdateAssistant = new CheckUpdateAssistant();

global.log = function (msg) { console.log (msg); };

//parameters:
//checkUpdateAssistant.parseManifest(manifest, deviceName, ignorePlatformVersion, changes, localVersion);

fs.readFile("manifest.json", function (err, data) {
    "use strict";
    if (err) {
        console.error("Could not read manifest: ", err);
        return;
    }
    var manifest = JSON.parse(data), changes = [], newVersion;

    newVersion = checkUpdateAssistant.parseManifest(manifest, "mako", false, changes, 23);

    if (newVersion !== 24) {
        console.error("Test1: Version 24 expected, got " + newVersion);
    }
    if (changes.length !== 1 || changes[0].version !== 24) {
        console.error("Test1: Change array of length 1 with change for version 24 expected, got: ", changes);
    }

    changes = [];
    newVersion = checkUpdateAssistant.parseManifest(manifest, "maguro", false, changes, 23);
    if (newVersion !== 23) {
        console.error("Test1: Version 23 expected, got " + newVersion);
    }
    if (changes.length !== 0) {
        console.error("Test1: Change array of length 0, got: ", changes);
    }

    changes = [];
    newVersion = checkUpdateAssistant.parseManifest(manifest, "maguro", true, changes, 23);
    if (newVersion !== 29) {
        console.error("Test1: Version 29 expected, got " + newVersion);
    }
    if (changes.length !== 3 || changes[0].version !== 29 || changes[1].version !== 26 || changes[2].version !== 25) {
        console.error("Test1: Change array of length 3 with changes for [29, 26, 25], got: ", changes);
    }

    changes = [];
    newVersion = checkUpdateAssistant.parseManifest(manifest, "mako", true, changes, 23);
    if (newVersion !== 30) {
        console.error("Test1: Version 30 expected, got " + newVersion);
    }
    if (changes.length !== 7 || changes[0].version !== 30 || changes[1].version !== 29 || changes[2].version !== 28 || changes[3].version !== 27 || changes[4].version !== 26 || changes[5].version !== 25 || changes[6].version !== 24) {
        console.error("Test1: Change array of length 7 with changes for [30, 29, 28, 27, 26, 25, 24], got: ", changes);
    }
});


