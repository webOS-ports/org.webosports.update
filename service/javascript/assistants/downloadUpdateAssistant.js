/*jslint node: true */
/*global log, debug, Future, Utils, ActivityHelper, Config, Parser */

var DownloadUpdateAssistant = function () {
	"use strict";
};

DownloadUpdateAssistant.prototype.run = function (outerFuture, subscription) {
	"use strict";
	var future = new Future(), args = this.controller.args,
		numDownloaded = 0, downloading = false;
	
	if (args) {
		ActivityHelper.adoptActivity(args.$activity);
	}
	
	//send status to application... 
	function logToApp(status) {
		log("============= ToApp: " + JSON.stringify(status));
		if (subscription) {
			var f = subscription.get();
			f.result = status;
		} else {
			log("Don't have subscription... :(");
		}
	}
	
	//send errors to application:
	function handleError(msg, error) {
		var outMsg = msg + ": " + (error.message || error.msg) + (error.code ? (", code: " + error.code) : "");
		log(msg + ": " + JSON.stringify(error));
		outerFuture.result = { returnValue: false, success: false, error: true, msg: outMsg};
	}
		
	//handles child process output and termination:
	function childCallback() {
		try {
			var result = future.result;
			if (result.finished && result.error === false) {			
				if (downloading) {
					//we are done:
					outerFuture.result = {success: true, finished: true, error: false, msg: "Done downloading."};
				} else {
					//package feed update finished. Go on.
					downloading = true;
					future.nest(Utils.spawnChild(Config.downloadCommand, Parser.parseDownloadOutput));
					future.then(childCallback);
				}
			} else {
				throw ({message: "Child did finish with error", errorCode: result.code});
			}
		} catch (e) {
			handleError("Error during " + (downloading ? "downloading packages" : "updating feeds"), e);
		}
	}
	
	future.nest(Utils.spawnChild(Config.preDownloadCommand, Parser.parseUpdateOutput));
	
	future.then(childCallback);
	
	return outerFuture;
};

