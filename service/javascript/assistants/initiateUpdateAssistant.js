/*jslint node: true */
/*global log, debug, Future, Utils, ActivityHelper, Config */

var InitiateUpdateAssistant = function () {
    "use strict";
};

InitiateUpdateAssistant.prototype.run = function (outerFuture) {
    "use strict";
    var future = new Future();

    //send errors to application:
    function handleError(msg, error) {
        log(msg + ": " + JSON.stringify(error));
        outerFuture.result = { returnValue: false, success: false, error: true, msg: error.message};
    }

    //handles child process output and termination:
    function childCallback() {
        var result = Utils.checkResult(future);
        if (result.finished && result.error === false) {
            log("Log initiated reboot sucessfully.");
            outerFuture.result = {success: true, error: false};
        } else {
            handleError("Error during initiating update", result.exception);
        }
    }

    future.nest(Utils.spawnChild(Config.rebootToUpdateModeCommand));
    future.then(childCallback);

    return outerFuture;
};

module.exports = InitiateUpdateAssistant;
