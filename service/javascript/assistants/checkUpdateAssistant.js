/*jslint node: true */
/*global log, debug, Future, Utils, ActivityHelper, PalmCall */

var CheckUpdateAssistant = function () {
    "use strict";
};

CheckUpdateAssistant.prototype.run = function (outerFuture) {
    "use strict";
    var future = new Future(), args = this.controller.args, localVersion, remoteVersion, manifest, ignorePlatformVersion = false;

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
            future.nest(PalmCall.call("palm://com.palm.systemservice/", "getPreferences", {
                keys: ["updateIgnorePlatformVersion"]
            }));

        } else {
            handleError("Not online, can't check for updates.");
        }
    });

    future.then(this, function getPrefCallback() {
        var result = Utils.checkResult(future);
        if (result.returnValue) {
            ignorePlatformVersion = result.updateIgnorePlatformVersion;
        } else {
            log("Could not get pref, continue with default value");
        }
        future.nest(Utils.getLocalPlatformVersion());
    });

    future.then(this, function localVersionCallback() {
        var result = Utils.checkResult(future);
        log("localVersion came back: " + JSON.stringify(result));
        if (result.returnValue === true) {
            localVersion = result.version;
            log("Have localVersion: " + localVersion);
            future.nest(Utils.getManifest());
        } else {
            log("localVersion came back WITH ERROR: " + JSON.stringify(result));
            handleError("Could not get local plattform version.", result.exception);
        }
    });

    future.then(this, function manifestCallback() {
        var result = Utils.checkResult(future);
        if (result && result.returnValue === true) {
            manifest = result.manifest;
            remoteVersion = manifest.platformVersion;

            if (ignorePlatformVersion) {
                manifest.changeLog.forEach(function getMaxVersion(entry) {
                    if (entry.version > remoteVersion) {
                        remoteVersion = entry.version;
                    }
                });
                log("Read maximum version: " + remoteVersion, " from manifest " + JSON.stringify(manifest));
            }

            if (!remoteVersion) {
                handleError("Could not parse remote version from manifest", {message: JSON.stringify(manifest)});
                return;
            }

            //potentially write update-to-version file.
            future.nest(Utils.handleUpdateFiles(remoteVersion, manifest));
        } else {
            handleError("Could not get manifest", future.exception);
        }
    });

    future.then(function handleUpdateFilesCallback() {
        var result = Utils.checkResult(future), changesSinceLast = [], newResult;
        if (result.returnValue) {
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

                //notify user that we have an update
                //first close all old notifications, then create a new one.
                PalmCall.call("palm://org.webosports.notifications", "closeAllNotifications", {}).then(function () {
                    PalmCall.call("palm://org.webosports.notifications", "createNotification", {
                        launchId: "org.webosports.app.settings",
                        launchParams: {page: "SystemUpdates", needUpdate: true, changesSinceLast: changesSinceLast },
                        title: "System update available",
                        message: "New version " + remoteVersion
                    }).then(function appManagerCallback(f) {
                        log("ApplicationManager call came back: " + JSON.stringify(f.result));
                    });
                });

                outerFuture.result = newResult;
            } else {
                //no update necessary.
                outerFuture.result = { returnValue: true, success: true, needUpdate: false};
            }
        } else {
            handleError("Something went wrong in the filesystem.", result.message);
        }
    });

    return outerFuture;
};

CheckUpdateAssistant.prototype.complete = function (activity) {
    "use strict";
    return ActivityHelper.restartActivity(activity);
};
