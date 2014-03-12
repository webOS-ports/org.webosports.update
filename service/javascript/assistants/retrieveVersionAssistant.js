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
		outerFuture.result = { returnValue: false, localVersion: "unknown", message: error.message};
	}

	future.nest(Utils.getLocalPlatformVersion());

	future.then(this, function localVersionCallback() {
		try {
			var result = future.result;
			log("localVersion came back: " + JSON.stringify(result));
			if (result.returnValue === false) {
				throw {message: "Could not get local plattform version. No error specified.", errorCode: -1};
			}
			outerFuture.result = { returnValue: true, localVersion: result.version};
		} catch (e) {
			log("localVersion came back WITH ERROR: " + JSON.stringify(e));
			handleError("Could not get local plattform version", e);
		}
	});

	return outerFuture;
};
