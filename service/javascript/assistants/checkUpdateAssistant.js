/*jslint node: true */
/*global log, debug, Future, Utils, ActivityHelper, PalmCall */

var CheckUpdateAssistant = function () {
    "use strict";
};

CheckUpdateAssistant.prototype.run = function (outerFuture) {
    "use strict";
    var future = new Future(), args = this.controller.args, localVersion, remoteVersion, manifest;

    function handleError(msg, error) {
        if (!error) {
            error = {};
        }
        log(msg + ": " + JSON.stringify(error));
        var message = msg;
        if (typeof error === "string") {
            msg += " - " + error;
        } else if (error.message) {
            msg += " - " + error.message;
        }
        outerFuture.result = { returnValue: false, success: false, needUpdate: false, message: msg};
    }

    future.nest(PalmCall.call("palm://com.palm.connectionmanager", "getStatus", {subscribe: false}));

    future.then(function getStatusCB() {
        var result = Utils.checkResult(future);
        log("Connection status: " + JSON.stringify(result));
        if (result.returnValue && result.isInternetConnectionAvailable) {
            future.nest(Utils.getLocalPlatformVersion());
        } else {
            handleError("Not online, can't check for updates.");
        }
    });

    future.then(this, function localVersionCallback() {
        var result = Utils.checkResult(future);
        log("localVersion came back: " + JSON.stringify(result));
        if (result.returnValue === true) {
            localVersion = result.version;
            future.nest(Utils.getManifest());
        } else {
            log("localVersion came back WITH ERROR: " + JSON.stringify(result));
            handleError("Could not get local plattform version.", result.exception);
        }
    });

    future.then(this, function manifestCallback() {
        var result = Utils.checkResult(future), changesSinceLast = [], newResult;
        if (result && result.returnValue === true) {
            manifest = result.manifest;
            remoteVersion = manifest.platformVersion;

            if (!remoteVersion) {
                handleError("Could not parse remote version from manifest", {message: JSON.stringify(manifest)});
                return;
            }

            log("Remote version came back: " + remoteVersion);
            if (remoteVersion > localVersion) {
                //get changes since last update:
                manifest.changeLog.forEach(function filterChanges(change) {
                    if (change.version > localVersion) {
                        changesSinceLast.push(change);
                    }
                });
                changesSinceLast.sort(function sortFunction(a, b) {
                    return b.version - a.version;
                });

                newResult = {
                    returnValue: true,
                    success: true,
                    needUpdate: true,
                    changesSinceLast: changesSinceLast
                };

                //notify user that we have an update:
                //TODO: replace with something else that creates a user notification.
                /*PalmCall.call("palm://com.palm.applicationManager", "launch", {
                    id: "org.webosports.app.update",
                    params: newResult
                }).then(function appManagerCallback(f) {
                    log("ApplicationManager call came back: " + JSON.stringify(f.result));
                });*/

                outerFuture.result = newResult;
            } else {
                //no update necessary.
                outerFuture.result = { returnValue: true, success: true,  needUpdate: false};
            }

        } else {
            handleError("Could not get manifest", future.exception);
        }
    });

    return outerFuture;
};

CheckUpdateAssistant.prototype.complete = function (activity) {
    "use strict";
    return ActivityHelper.restartActivity(activity);
};
