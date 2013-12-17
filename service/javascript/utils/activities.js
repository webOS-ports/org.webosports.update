/*global Future, log, Activity, Config, PalmCall */

var ActivityHelper = (function () {
	"use strict";
	var activityName = "org.webosports.service.update: Periodic Update Check",
		checkedActivity = false;

	//public interface
	return {
		//we also have this in a configuration file...
		//but current OWO does not read that, I fear... probably legacy hasn't read that, neither.
		//to get the activity one would need to run the app and check for updates or
		//run luna-send -n 1 palm://org.webosports.service.update/checkUpdate {}
		createActivity: function () {
			var future = new Future(), activity;

			activity = {
				name:			activityName,
				description:	"Periodic system update check",
				type: {
					background:		true,
					userInitiated:	false,
					pausable:		true,
					cancellable:	true,
					probe:			true, //only update check, so that is ok here
					persist:		true,
					explicit:		true,
					continuous:		false,
					power:			true, //I think that is necessary, because we are waiting for network, right?
					powerDebounce:	true
				},
				schedule: { interval: "24h", precise: false },
				requirements:	{ internetConfidence: "fair" },
				callback:		{ method: "palm://org.webosports.update/checkUpdate"}
			};

			future.nest(PalmCall.call("palm://com.palm.activitymanager/", "create", {
				activity: activity,
				replace: true,
				start: true
			}));

			future.then(this, function createCallback() {
				var result = future.result || future.exception;
				log("Create activity came back: " + JSON.stringify(result));
				future.result = result;
			});

			return future;
		},

		checkActivity: function () {
			var future = new Future();

			//This currently gives bad exceptions and some kind of timeout in OWO. ActivityManager not working??? :(
			log("activityManager => getDetails");
			future.nest(PalmCall.call("palm://com.palm.activitymanager/", "getDetails", {
				activityName: activityName
			}));

			future.then(this, function getDetailsCB() {
				log("getDetailsCB!!");
				var result = future.result || future.exception;
				if (result.returnValue !== true) {
					log("Activity was not present, creating it: " + JSON.stringify(result));
					future.nest(ActivityHelper.createActivity());
				} else {
					log("Activity already existed: " + JSON.stringify(result));
					future.result = {returnValue: true};
				}
				checkedActivity = true;
			});

			//future.result = {returnValue: true};

			return future;
		},

		restartActivity: function (activity) {
			var restart;
			if (activity) {
				log("Completing activity " + activity.name);
				restart = activity.name === activityName; //could also be called from command line. Don't restart then.
				return activity.complete(restart);
			}
			return new Future({returnValue: true});
		},

		//check if service controller really already does that for us. I'm not sure. Maybe on touch pad?
		adoptActivity: function (passed_activity) {
			var future = new Future();
			if (passed_activity && passed_activity.name === activityName) {
				log("Need to adopt activity... Is this done by framework??");
				future.nest(PalmCall.call("palm://com.palm.activitymanager/", "adopt", {
					activityId: passed_activity.id
				}));
				future.result = {returnValue: true};
			} else {
				if (!checkedActivity) { //check activity at max once per runtime..
					log("No activity passed. Check for persistent activity.");
					future.nest(ActivityHelper.checkActivity());
				} else {
					future.result = {returnValue: true};
				}
			}
			return future;
		}
	};
}());