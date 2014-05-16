/*jslint node: true */
/*global log, debug, Future, Utils, ActivityHelper, PalmCall */

var RetrieveVersionAssistant = function () {
    "use strict";
};

RetrieveVersionAssistant.prototype.run = function (outerFuture) {
    "use strict";
    var future = new Future(), args = this.controller.args, localVersion;

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

    future.nest(Utils.getLocalPlatformVersion());

    future.then(this, function localVersionCallback() {
        var result = Utils.checkResult(future);
        if (result.returnValue === true) {
            outerFuture.result = { returnValue: true, localVersion: result.version, codename: result.codename};
        } else {
            handleError("Could not get local plattform version", result.exception);
        }
    });

    return outerFuture;
};
