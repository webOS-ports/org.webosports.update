/*jslint node: true */
/*global log, fs, debug, Future, Utils, ActivityHelper, Config, Parser, PalmCall */

var DownloadUpdateAssistant = function () {
    "use strict";
};

DownloadUpdateAssistant.prototype.run = function (outerFuture, subscription) {
    "use strict";
    var future = new Future(),
        args = this.controller.args,
        numDownloaded = 0,
        toDownload = 0,
        doneUpdating = false,
        doneGetNumPackages = false;

    //send status to application...
    function logToApp(numNew) {
        numDownloaded += numNew;
        var f, status = { numDownloaded: numDownloaded, toDownload: toDownload };
        if (subscription) {
            f = subscription.get();
            f.result = status;
        } else {
            log("Don't have subscription... Would have sended: " + JSON.stringify(status));
        }
    }

    //send errors to application:
    function handleError(msg, error) {
        var outMsg = msg;
        if (error) {
            outMsg += ":\n" + (error.message || error.msg) + (error.code ? ("\nErrorCode: " + error.code) : "") + (error.errorCode ? ("\nErrorCode: " + error.errorCode) : "");
        }
        log(msg + ": " + JSON.stringify(error));
        outerFuture.result = {
            success: false,
            error: true, //tell app we have an error message
            msg: outMsg,
            errorStage: doneUpdating ? doneGetNumPackages ? "download" : "getNumPackages" : "feedsUpdate"
        };
    }

    //handles child process output and termination:
    function childCallback() {
        var result = Utils.checkResult(future);
        if (result.finished && result.error === false) {
            if (doneGetNumPackages) {
                log("Download Log:\n" + Parser.getDownloadLog());
                //we are done:
                outerFuture.result = {success: true, finished: true, error: false, msg: "Done downloading."};
            } else if (doneUpdating) {
                doneGetNumPackages = true;
                toDownload = Parser.getNumPackages();
                log("Get num packages: " + toDownload);
                future.nest(Utils.spawnChild(Config.downloadCommand, Parser.parseDownloadOutput.bind({}, logToApp)));
                future.then(childCallback);
            } else {
                //package feed update finished. Go on.
                doneUpdating = true;
                log("Update Log:\n" + Parser.getUpdateLog());

                future.nest(Utils.spawnChild(Config.numPackagesCommand, Parser.parseNumPackages));
                future.then(childCallback);
            }
        } else {
            handleError("Error during " + (doneUpdating ? "downloading packages" : "updating feeds"), result.exception || Parser.getErrorMessage());
        }
    }

    Parser.clear();

    future.nest(PalmCall.call("palm://com.palm.connectionmanager", "getStatus", {subscribe: false}));

    future.then(function getStatusCB() {
        var result = Utils.checkResult(future);
        if (result.returnValue && result.isInternetConnectionAvailable) {
            future.nest(Utils.checkForSpecificUpdateVersion());
        } else {
            handleError("No internet connection.");
        }
    });

    future.then(function checkForSpecificUpdateVersionCB() {
        var result = Utils.checkResult(future);
        if (result.returnValue) {
            future.nest(Utils.checkDirectory(Config.downloadPath));
        } else {
            handleError("Filesystem error: " + result.message);
        }
    });

    future.then(function pathCB() {
        var result = Utils.checkResult(future);
        if (result.returnValue) {
            if (args.skipFeedsUpdate) {
                doneUpdating = true;
                future.nest(Utils.spawnChild(Config.numPackagesCommand, Parser.parseNumPackages));
            } else {
                future.nest(Utils.spawnChild(Config.preDownloadCommand, Parser.parseUpdateOutput));
            }
        } else {
            handleError("Error during checking/creating download directory", result.exception);
        }
    });

    future.then(childCallback);

    return outerFuture;
};

module.exports = DownloadUpdateAssistant;
