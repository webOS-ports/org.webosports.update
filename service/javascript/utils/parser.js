/*global Future, log */

var Parser = (function () {
	"use strict";
	var updateLog = [],
		downloadLog = [],
		numPackages = 0;

	function countLines(msg) {
		return msg.split("\n").length - 1; //ignore empty line.
	}

	function parseArrayForError(array) {
		var i, logEntry, startIndex, errorOutput = false, errors = [];

		for (i = 0; i < array.length; i += 1) {
			logEntry = array[i];

			if (errorOutput) {
				errors.push(logEntry);
			} else {
				startIndex = logEntry.indexOf("Collected errors");
				if (startIndex >= 0) {
					startIndex += "Collected errors:".length;
					errorOutput = true;
					errors.push(logEntry.substr(startIndex));
				}
			}
		}

		return errors.join("\n");
	}

	function findStringsInArray(array, strings) {
		var i, j, result = [], done;
		for (i = 0; i < strings.length; i += 1) {
			result.push(false);
		}

		for (j = 0; j < array.length; j += 1) {
			done = true;
			for (i = 0; i < strings.length; i += 1) {
				if (!result[i]) {
					if (array[j].indexOf(strings[i]) !== -1) {
						result[i] = true;
					} else {
						done = false; //did not find string i, need to keep searching.
					}
				}
			}

			if (done) {
				return { allFound: true, results: result };
			}
		}

		//if we reached here not all strings were found:
		return { allFound: false, results: result };
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
			log("Got update output: " + JSON.stringify(data));
			var msg = data.type + ": " + data.msg;
			updateLog.push(msg);
			return;
		},

		parseNumPackages: function (data) {
			if (data.type === "out") {
				numPackages += countLines(data.msg);
			} else {
				log("Got error output from list-upgradable: " + data.msg);
			}
		},

		//clears temporary data:
		clear: function () {
			updateLog = [];
			downloadLog = [];
			numPackages = 0;
		},

		getUpdateLog: function () {
			return updateLog.join("\n");
		},

		getDownloadLog: function () {
			return downloadLog.join("\n");
		},

		getNumPackages: function () {
			return numPackages;
		},

		getErrorMessage: function () {
			var updateErrors, downloadErrors;
			updateErrors = parseArrayForError(updateLog);
			if (updateErrors) {
				log("UpdateErrors: " + updateErrors);

				if (findStringsInArray(updateLog, ["Downloading", "Inflating"]).allFound) {
					//at least some feeds did download ok.
					return "Download of some feeds failed: " + updateErrors;
				} else {
					//really in error state, probably network issue?
					return "Update of package feeds failed completely.";
				}
			}

			downloadErrors = parseArrayForError(downloadLog);
			if (downloadErrors) {
				log("DownloadErrors: " + downloadErrors);
			}

			return updateErrors + "\n" + downloadErrors;
		}
	};

}());
