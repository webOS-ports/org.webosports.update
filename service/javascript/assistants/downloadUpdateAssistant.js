/*jslint node: true */
/*global log, fs, debug, Future, Utils, ActivityHelper, Config, Parser, PalmCall */

var DownloadUpdateAssistant = function () {
    "use strict";
};

DownloadUpdateAssistant.prototype.run = function (outerFuture, subscription) {
    "use strict";
    var future = new Future(),
        updateData;

    //send status to application...
    function logToApp(result) {
        var f, status = { percentage: (100 * result.amountReceived / result.amountTotal).toFixed(2) };
        if (isNaN(status.percentage)) {
            return;
        }
        if (subscription) {
            f = subscription.get();
            f.result = status;
        } else {
            log("Don't have subscription... Would have sended: " + JSON.stringify(status));
        }
    }

    //send errors to application:
    function handleError(msg, error, needCheck) {
        var outMsg = msg;
        if (error) {
            outMsg += ":\n" + (error.message || error.msg) + (error.code ? ("\nErrorCode: " + error.code) : "") + (error.errorCode ? ("\nErrorCode: " + error.errorCode) : "");
        }
        log(msg + ": " + JSON.stringify(error));
        outerFuture.result = {
            success: false,
            error: true, //tell app we have an error message
            msg: outMsg,
            needCheck: !!needCheck
        };
    }

    function handleDownloadResults(innerFuture) {
        var result = Utils.checkResult(innerFuture);
        debug("Got download result: " + JSON.stringify(result));
        if (result.returnValue) {
            if (!result.aborted && !result.completed && !result.interrupted) {
                //add me again.
                logToApp(result);
                debug("Download not yet done, keep waiting.");
                innerFuture.then(handleDownloadResults);
            } else {
                //we are done.
                debug("Download done, continue future...");
                future.result = result;
            }
        } else {
            handleError("Error during download", result.exception);
        }
    }

    future.nest(PalmCall.call("luna://com.webos.service.connectionmanager", "getStatus", {subscribe: false}));

    future.then(function readUpdateResults() {
        var result = Utils.checkResult(future);
        if (result.returnValue) {
            future.nest(Utils.readUpdateResults());
        } else {
            handleError("No internet connection.");
        }
    });

    future.then(function getDeviceImages() {
        var result = Utils.checkResult(future);
        if (result.returnValue) {
            updateData = result.results;
            future.nest(Utils.getDeviceImages(updateData.buildTree));
        } else {
            handleError("No update data stored, check for update first, please.", false, true);
        }
    });

    future.then(function initiateImageDownload() {
        var result = Utils.checkResult(future), url;
        if (result.returnValue) {
            if (result.deviceImages &&
                result.deviceImages[updateData.deviceName] &&
                result.deviceImages[updateData.deviceName][updateData.version]) {
                url = result.deviceImages[updateData.deviceName][updateData.version].url;
                debug("Got url: " + url);
                PalmCall.call("luna://com.webos.service.downloadmanager", "download", {
                    target: url,
                    keepFilenameOnRedirect: true,
                    targetFilename: Config.downloadFilename,
                    targetDir: Config.downloadPath,
                    subscribe: true
                }).then(handleDownloadResults);
            } else {
                handleError("Device images file corrupt or version not present anymore. Please check for updates again.", false, true);
            }
        } else {
            handleError("Could not download device images file from server.");
        }
    });

    future.then(function downloadDone() {
        var result = Utils.checkResult(future);
        debug("Download done: ", result);
        if (result.returnValue && result.completed && result.completionStatusCode === 200) {
            outerFuture.result = {
                success: true,
                finished: true,
                error: false,
                msg: "Done downloading."
            };
        } else {
            handleError("Error during download", result.exception);
        }
    });

    return outerFuture;
};

module.exports = DownloadUpdateAssistant;
