/*global fs, spawn, Future, Config, log, utils, AjaxCall */

var Utils = (function () {
    "use strict";


    //public interface
    return {
        //helper to check result of futures with catching exceptions
        //because futures can "transport" exceptions to waiting
        //functions.
        //Using this small function should allow V8 to optimize the other functions,
        //because functions including try-catch can not be optimized currently.
        checkResult: function (future) {
            var exception = future.exception;
            if (exception) {
                return {returnValue: false, exception: future.exception};
            } else {
                return future.result;
            }
        },

        getLocalPlatformVersion: function () {
            var future = new Future();

            fs.readFile(Config.versionFile, function fileReadCallback(err, data) {
                if (err) {
                    future.exception = { message: err.message, errorCode: -1 };
                    //future.result = { returnValue: false, message: err.message };
                    log("Error while reading version file ( " + Config.versionFile + " ): " + JSON.stringify(err));
                } else {
                    var version, dataStr = data.toString(), matches, codename;
                    log("Got data from file: " + dataStr);

                    matches = Config.parseWholeStringRegExp.exec(dataStr);
                    //log("parseWholeStringRegExp: " + JSON.stringify(matches));
                    version = matches && parseInt(matches[Config.parseWholeStringIndex], 10);

                    if (!version && version !== 0) {
                        log("WARNING: Using parsing callback. Better adjust parseWholeStringRegExp.");
                        matches = Config.parseOnlyPlattformVersionRegExp.exec(dataStr);
                        version = matches && parseInt(matches[1], 10); //first match is always the complete string.

                        codename = dataStr.substring(dataStr.lastIndexOf("(") + 1, dataStr.length - 2);
                    } else {
                        codename = matches[Config.parseWholeStringCodenameIndex];
                    }

                    if (!version && version !== 0) {
                        future.exception = { message: "Could not parse version from file: " + dataStr, errorCode: -1};
                    } else {
                        if (codename) {
                            codename = codename.substr(codename.indexOf("-") + 1);
                            codename = codename[0].toUpperCase() + codename.substr(1); //make sure first char is upper case.
                        }

                        future.result = { returnValue: true, version: version, codename: codename };
                    }
                }
            });

            return future;
        },

        checkDirectory: function (path) {
            var future = new Future();

            fs.exists(path, function pathCheckCallback(exists) {
                if (!exists) {
                    fs.mkdir(Config.downloadPath, function creationCallback(err) {
                        if (err) {
                            future.exception = err;
                        } else {
                            log("Download directory created.");
                            future.result = {returnValue: true};
                        }
                    });
                } else {
                    //directory is there, all fine.
                    future.result = {returnValue: true};
                }
            });

            return future;
        },

        getManifest: function () {
            var future = new Future();

            future.nest(AjaxCall.get(Config.manifestUrl));

            future.then(this, function getCallback() {
                try {
                    var result = future.result;
                    if (result.status === 200) {
                        if (result.responseJSON) {
                            future.result = {returnValue: true, manifest: result.responseJSON };
                        } else {
                            throw {message: "No JSON in response.", errorCode: -1 };
                        }
                    } else {
                        throw {message: "Status code falsy: " + result.status, errorCode: result.status};
                    }
                } catch (e) {
                    log("Could not get manifest: " + JSON.stringify(e));
                    future.exception = e;
                }
            });

            return future;
        },

        spawnChild: function (command, outputCallback) {
            var future = new Future(), child;

            child = spawn(command.cmd, command.args, command.options);

            child.stdout.on("data", function (data) {
                if (typeof outputCallback === "function") {
                    try {
                        outputCallback({msg: data.toString(), type: "out"});
                    } catch (e) {
                        future.exception = e;
                    }
                } else {
                    log("Child-out: " + data.toString());
                }
            });

            child.stderr.on("data", function (data) {
                if (typeof outputCallback === "function") {
                    try {
                        outputCallback({msg: data.toString(), type: "err"});
                    } catch (e) {
                        future.exception = e;
                    }
                } else {
                    log("Child-err: " + data.toString());
                }
            });

            child.on("close", function (code) {
                future.result = {finished: true, error: code !== 0, code: code};
            });

            child.on("error", function (err) {
                log("Error in spawning child: " + err.message);
                future.result = {finished: true, error: true, errorObj: err};
            });

            return future;
        }
    };

}());
