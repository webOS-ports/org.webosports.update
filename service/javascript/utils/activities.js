/*global Future, log, Activity, Config, PalmCall */

var ActivityHelper = (function () {
    "use strict";
    var activityName = "org.webosports.service.update: Periodic Update Check",
        checkedActivity = false;

    //public interface
    //currently only restartActivity is called, if periodic activity happens.
    return {
        createActivity: function () {
            var future = new Future(), activity;

            activity = {
                name:            activityName,
                description:    "Periodic system update check",
                type: {
                    background:    true,
                    userInitiated: false,
                    pausable:      true,
                    cancellable:   true,
                    probe:         true, //only update check, so that is ok here
                    persist:       true,
                    explicit:      true,
                    continuous:    false,
                    power:         true, //I think that is necessary, because we are waiting for network, right?
                    powerDebounce: true
                },
                schedule:     { interval: "24h", precise: false },
                requirements: { internetConfidence: "fair" },
                callback:     { method: "palm://org.webosports.update/checkUpdate"}
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
                activityName: activityName,
                current: true,
                internal: true
            }));

            future.then(this, function getDetailsCB() {
                var result = future.exception || future.result;
                if (result.returnValue !== true) {
                    log("Activity was not present, creating it: " + JSON.stringify(result));
                    future.nest(ActivityHelper.createActivity());
                } else {
                    log("Activity already exists.");
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
        }
    };
}());
