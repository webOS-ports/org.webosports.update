/*jslint node: true */
/*global log, debug, Future, Utils, ActivityHelper, Config */

var InitiateUpdateAssistant = function () {
	"use strict";
};

InitiateUpdateAssistant.prototype.run = function (outerFuture) {
	"use strict";
	var future = new Future(), args = this.controller.args;
	
	if (args) {
		ActivityHelper.adoptActivity(args.$activity);
	}
	
	//send errors to application:
	function handleError(msg, error) {
		log(msg + ": " + JSON.stringify(error));
		outerFuture.result = { returnValue: false, success: false, error: true, msg: error.message};
	}
	
	//handles child process output and termination:
	function childCallback() {
		try {
			var result = future.result;
			if (result.finished && result.error === false) {
				log("Log initiated reboot sucessfully.");
				outerFuture.result = {success: true, error: false};
			} else {
				throw ({message: "Child did finish with error", errorCode: result.code});
			}
		} catch (e) {
			handleError("Error during initiating update", e);
		}
	}
	
	future.nest(Utils.spawnChild(Config.rebootToUpdateModeCommand));
	future.then(childCallback);
	
	return outerFuture;
};
