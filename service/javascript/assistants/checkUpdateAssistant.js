/*jslint node: true */
/*global log, debug, Future, Utils, ActivityHelper, PalmCall */

var CheckUpdateAssistant = function () {
	"use strict";
};

CheckUpdateAssistant.prototype.run = function (outerFuture) {
	"use strict";
	var future = new Future(), args = this.controller.args, localVersion, remoteVersion, manifest;
	
	if (args) {
		ActivityHelper.adoptActivity(args.$activity);
	}
	
	function handleError(msg, error) {
		if (!error) {
			error = {};
		}
		log(msg + ": " + JSON.stringify(error));
		outerFuture.result = { returnValue: false, success: false, needUpdate: false, message: error.message};
	}
	
	future.nest(Utils.getLocalPlatformVersion());
	
	future.then(this, function localVersionCallback() {
		try {
			var result = future.result;
			log("localVersion came back: " + JSON.stringify(result));
			if (result.returnValue === true) {
				localVersion = result.version;
				future.nest(Utils.getManifest());
			} else {
				throw {message: "Could not get local plattform version. No error specified.", errorCode: -1};
			}
		} catch (e) {
			log("localVersion came back WITH ERROR: " + JSON.stringify(e));
			handleError("Could not get local plattform version", e);
		}
	});
	
	future.then(this, function manifestCallback() {
		try {
			var result = future.result, changesSinceLast = [], newResult;
			if (result && result.returnValue === true) {
				manifest = result.manifest;
				remoteVersion = manifest.platformVersion;
				
				if (!remoteVersion) {
					handleError("Could not parse remote version from manifest", {message: JSON.stringify(manifest)});
					return;
				}
					
				if (remoteVersion === localVersion) {
					outerFuture.result = { returnValue: true, success: true,  needUpdate: false};
				} else {
					//get changes since last update:
					manifest.changeLog.forEach(function filterChanges(change) {
						if (change.version > localVersion) {
							changesSinceLast.push(change);
						}
					});
					changesSinceLast.sort(function sortFunction(a, b) {
						return b.version - a.version;
					});
				
					newResult = { returnValue: true, success: true, needUpdate: true,
									changesSinceLast: changesSinceLast };
				
					//notify user that we have an update:
					PalmCall.call("palm://com.palm.applicationManager", "launch", {
						id: "org.webosports.app.update",
						params: newResult
					}).then(function appManagerCallback(f) {
						log("ApplicationManager call came back: " + JSON.stringify(f.result));
					});
					
					outerFuture.result = newResult;
				}
			
			} else {
				handleError("Could not get manifest", future.exception);
			}
		} catch (e) {
			handleError("Could not get manifest", e);
		}
	});
	
	return outerFuture;
};

CheckUpdateAssistant.prototype.complete = function (activity) {
	"use strict";
	return ActivityHelper.restartActivity(activity);
};