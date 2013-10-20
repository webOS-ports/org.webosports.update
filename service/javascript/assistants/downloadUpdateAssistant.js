/*jslint node: true */
/*global log, debug, Future, Utils, ActivityHelper */

var DownloadUpdateAssistant = function () {
	"use strict";
};

DownloadUpdateAssistant.prototype.run = function (outerFuture, subscription) {
	"use strict";
	var future = new Future(), args = this.controller.args,
		start = Date.now(), numDownloaded = 0;
	
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
		log(msg + ": " + JSON.stringify(error));
		outerFuture.result = { returnValue: false, success: false, error: true, msg: error.message};
	}
	
	function idle() {
		var now = Date.now(), secs = ((now - start) / 1000.0);
				
		if (secs % 10 < 1) {
			numDownloaded += 1;
			logToApp({numDownloaded: numDownloaded, totalDownload: 30});
		}
		
		log("I'm idling for " + secs + " seconds now... lalala");
		if (secs > 11) {
			log("Ok, 5 min is enough. I'll exit.");
			outerFuture.result = {success: true, finished: true, error: false, msg: "all done"};
		} else {
			setTimeout(idle, 1000);
		}
	}
	
	setTimeout(idle, 1000);
	
	return outerFuture;
};

