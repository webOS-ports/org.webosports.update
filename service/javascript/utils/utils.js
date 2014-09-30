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

            //first try to read inofficial update file
            fs.exists(Config.currentVersionFile, function currentVersionFileExists(exists) {
                future.result = {returnValue: true, currentVersion: exists};
            });

            future.then(function existsCallback() {
                var result = Utils.checkResult(future);
                if (result.currentVersion) {
                    fs.readFile(Config.currentVersionFile, function fileReadCallback(err, data) {
                        if (err) {
                            log("Error while reading current version file ( " + Config.currentVersionFile + "): " + JSON.stringify(err));
                            future.result = {returnValue: true, currentVersion: 0};
                        } else {
                            future.result = {returnValue: true, currentVersion: parseInt(data, 10) };
                        }
                    });
                } else {
                    future.result = {returnValue: true, currentVersion: 0};
                }
            });

            future.then(function currentVersionCallback() {
                var result = Utils.checkResult(future);
                fs.readFile(Config.versionFile, function fileReadCallback(err, data) {
                    if (err) {
                        future.exception = { message: err.message, errorCode: -1 };
                        //future.result = { returnValue: false, message: err.message };
                        log("Error while reading version file ( " + Config.versionFile + " ): " + JSON.stringify(err));
                    } else {
                        var version, dataStr = data.toString(), matches, codename;
                        log("Got data from file: " + dataStr);

                        matches = Config.parseWholeStringRegExp.exec(dataStr) || [];
                        //log("parseWholeStringRegExp: " + JSON.stringify(matches));
                        version = matches && parseInt(matches[Config.parseWholeStringIndex], 10);

                        if (!version && version !== 0) {
                            log("WARNING: Using parsing fallback. Better adjust parseWholeStringRegExp.");
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

                            //return maximum version, either from plattform or currentVersion file
                            version = Math.max(version, result.currentVersion);
                            future.result = {
                                returnValue: true,
                                version: version,
                                codename: codename,
                                buildTree: matches[Config.parseWholeStringBuildTreeIndex],
                                build: matches[Config.parseWholeStringBuildIndex]
                            };
                        }
                    }
                });
            });

            return future;
        },

        handleUpdateFiles: function (remoteVersion, manifest) {
            var future = new Future();

            fs.unlink(Config.forceVersionFile, function (err) {
                if (err) {
                    log("Could not delete currentVersionFile: " + JSON.stringify(err));
                }
                future.result = {returnValue: true};
            });

            future.then(function deleteForceVersionFileCallback() {
                var result = Utils.checkResult(future);
                fs.unlink(Config.potentialForceVersionFile, function (err) {
                    if (err) {
                        log("Could not delete potentialForceVersionFile: " + JSON.stringify(err));
                    }
                    future.result = {returnValue: true};
                });
            });

            future.then(function deletePotentialForceVersionFileCallback() {
                var result = Utils.checkResult(future);
                fs.exists(Config.preferencesDir, function (exists) {
                    if (exists) {
                        future.result = {returnValue: true};
                    } else {
                        fs.mkdir(Config.preferencesDir, function (err) {
                            if (err) {
                                log("Could not create pref dir: " + JSON.stringify(err));
                                future.result = { returnValue: false };
                            } else {
                                future.result = { returnValue: true };
                            }
                        });
                    }
                });
            });

            future.then(function dirCreationCallback() {
                var result = Utils.checkResult(future);
                if (result.returnValue) {
                    if (remoteVersion > manifest.platformVersion) {
                        fs.writeFile(Config.potentialForceVersionFile, remoteVersion, function writeCB(err) {
                            if (err) {
                                log("Could not write potentialForceVersionFile: " + JSON.stringify(err));
                                future.result = { returnValue: false };
                            } else {
                                future.result = { returnValue: true };
                            }
                        });
                    } else {
                        //no need to write file
                        future.result = { returnValue: true };
                    }
                } else {
                    future.result = result;
                }
            });

            return future;
        },

        checkForSpecificUpdateVersion: function () {
            var future = new Future();

            fs.exists(Config.potentialForceVersionFile, function (exists) {
                if (exists) {
                    fs.rename(Config.potentialForceVersionFile, Config.forceVersionFile, function renameCB(err) {
                        if (err) {
                            log("Could not move potentialForceVersionFile to forceVersionFile: " + JSON.stringify(err));
                            future.result = {returnValue: false, message: JSON.stringify(err) };
                        } else {
                            future.result = {returnValue: true};
                        }
                    });
                } else {
                    future.result = {returnValue: true};
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

        getDeviceName: function () {
            var future = new Future(), data = "", error = "";

            function outputCB(input) {
                if (input.type === "out") {
                    data += input.msg;
                } else {
                    error += input.msg;
                }
            }

            future.nest(Utils.spawnChild(Config.getDeviceNameCommand, outputCB));

            future.then(function doneCB() {
                var result = future.result, info;

                try {
                    info = JSON.parse(data);
                    if (info.device_name) {
                        info.returnValue = true;
                        future.result = info;
                    } else {
                        throw {message: "No device name in result: " + data};
                    }
                } catch (e) {
                    //JSON parsing did not work :(
                    log("JSON parse of " + data + " failed.");
                    throw {message: "finished with code " + result.code + ", error messages: " + error};
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

module.exports = Utils;
