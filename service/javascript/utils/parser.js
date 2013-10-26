/*global Future, log */

var Parser = (function () {
	"use strict";
	var updateLog = [],
		downloadLog = [],
		numPackages = 0;
		
	function countLines(msg) {
		return msg.split("\n").length - 1; //ignore empty line.
	}
	
	//public interface
	return {
		parseDownloadOutput: function (callback, data) {
			if (data.type === "out") {
				var newPackages = countLines(data.msg);
				if (typeof callback === "function") {
					callback(newPackages);
				}
			} else {
				log("Had error in download: " + data.msg);
			}
			downloadLog.push(data.msg);
			return;
		},
		
		parseUpdateOutput: function (data) {
			var msg = data.type + ": " + data.msg;
			updateLog.push(msg);
			return;
		},
		
		parseNumPackages: function (data) {
			if (data.type === "out") {
				numPackages += countLines(data.msg);
			} else {
				log ("Got error output from list-upgradable: " + data.msg);
			}
		},
		
		//clears temporary data:
		clear: function() {
			updateLog = [];
			downloadLog = [];
			numPackages = 0;
		},
		
		getUpdateLog: function() {
			return updateLog.join("\n");
		},
		
		getDownloadLog: function() {
			return downloadLog.join("\n");
		},
		
		getNumPackages: function() {
			return numPackages;
		}
	};
	
}());
