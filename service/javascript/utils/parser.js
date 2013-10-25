/*global Future, log */

var Parser = (function () {
	"use strict";
	
	//public interface
	return {
		parseDownloadOutput: function (data) {
			log("download-" + data.type + ": " + data.msg);
			return;
		},
		
		parseUpdateOutput: function (data) {
			log("update-" + data.type + ": " + data.msg);
			return;
		}
	};
	
}());