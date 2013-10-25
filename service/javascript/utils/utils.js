/*global fs, spawn, Future, Config, log, utils, AjaxCall */

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
					var version, dataStr = data.toString(), matches;
					log("Got data from file: " + dataStr);
					
					matches = Config.parseWholeStringRegExp.exec(dataStr);
					//log("parseWholeStringRegExp: " + JSON.stringify(matches));
					version = matches && parseInt(matches[Config.parseWholeStringIndex], 10);

					if (!version && version !== 0) {
						log("WARNING: Using parsing callback. Better adjust parseWholeStringRegExp.");
						matches = Config.parseOnlyPlattformVersionRegExp.exec(dataStr);
						version = matches && parseInt(matches[1], 10); //first match is always the complete string.
					}
					
					if (!version && version !== 0) {
						future.exception = { message: "Could not parse version from file: " + dataStr, errorCode: -1};
					} else {
						future.result = { returnValue: true, version: version };
					}
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
		},
		
		spawnChild: function (command, outputCallback) {
			var future = new Future(), child;
			
			child = spawn(command.cmd, command.args, command.options);
			
			if (typeof outputCallback === "function") {
				child.stdout.on("data", function (data) {
					outputCallback({msg: data, type: "out"});
				});
			
				child.stderr.on("data", function (data) {
					outputCallback({msg: data, type: "err"});
				});
			}
			
			child.on("close", function (code) {
				future.result = {finished: true, error: code !== 0, code: code};
			});
			
			return future;
		}
	};
	
}());