/*jslint node: true */
/*global log, debug, Future, Utils, ActivityHelper */

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
	
	log("Initiate update is a stub...");
	outerFuture.result = {success: true, error: false, msg: "all done"};
	
	return outerFuture;
};
