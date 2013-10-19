/*global fs, Future, Config, log, utils, AjaxCall */

var Utils = (function () {
	"use strict";
	
	
	//public interface
	return {
		getLocalPlatformVersion: function () {
			var future = new Future();
			
			fs.readFile(Config.versionFile, function fileReadCallback(err, data) {
				if (err) {
					future.exception = { message: err.message, errorCode: -1 };
					//future.result = { returnValue: false, message: err.message };
					log("Error while reading version file ( " + Config.versionFile + " ): " + JSON.stringify(err));
				} else {
					log("Got data from file: " + JSON.stringify(data));
					future.result = { returnValue: true, version: parseInt(data.toString(), 10) };
				}
			});
			
			return future;
		},
		
		getManifest: function () {
			var future = new Future();
			
			future.nest(AjaxCall.get(Config.manifestUrl));
			
			future.then(this, function getCallback() {
				try {
					var result = future.result;
					if (result.status === 200) {
						if (result.responseJSON) {
							future.result = {returnValue: true, manifest: result.responseJSON };
						} else {
							throw {message: "No JSON in response.", errorCode: -1 };
						}
					} else {
						throw {message: "Status code falsy: " + result.status, errorCode: result.status};
					}
				} catch (e) {
					log("Could not get manifest: " + JSON.stringify(e));
					future.exception = e;
				}
			});
			
			return future;
		}
	};
	
}());