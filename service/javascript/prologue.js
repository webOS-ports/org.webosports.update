/*global IMPORTS, require:true, console */

console.error("Starting to load libraries.");
//TODO: check which imports we really need.
//TODO: remove debug output.

//webos specific imports:
var Foundations = IMPORTS.foundations;
var Future = Foundations.Control.Future;
var Activity = Foundations.Control.Activity;
var PalmCall = Foundations.Comms.PalmCall;
var AjaxCall = Foundations.Comms.AjaxCall;

//node.js imports:
if (typeof require === "undefined") {
	require = IMPORTS.require;
}
var fs = require('fs');
var spawn = require('child_process').spawn;

console.error("--------->Loaded Libraries OK1");

var log = function (msg) {
	"use strict";
	console.error(msg);
};

var debug = function (msg) {
	"use strict";
	console.error(msg);
};
