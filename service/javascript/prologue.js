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

var servicePath = fs.realpathSync(".");
var Config = require(servicePath + "/javascript/config.js");
var Utils = require(servicePath + "/javascript/utils/utils.js");
var Parser = require(servicePath + "/javascript/utils/parser.js");
var ActivityHelper = require(servicePath + "/javascript/utils/activities.js");

var CheckUpdateAssistant = require(servicePath + "/javascript/assistants/checkUpdateAssistant.js");
var DownloadUpdateAssistant = require(servicePath + "/javascript/assistants/downloadUpdateAssistant.js");
var InitiateUpdateAssistant = require(servicePath + "/javascript/assistants/initiateUpdateAssistant.js");
var RetrieveVersionAssistant = require(servicePath + "/javascript/assistants/retrieveVersionAssistant.js");

console.error("--------->Loaded Libraries OK1");

var log = function (msg) {
    "use strict";
    console.log(msg);
};

var debug = function (msg) {
    "use strict";
    //console.error(msg);
};
