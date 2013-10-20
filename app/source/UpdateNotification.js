/*jslint sloppy: true */
/*global enyo, console, UpdateApp, document */

enyo.kind({
	name: "UpdateNotification",
	published: {
		updateResults: null
	},
	components: [
		{
			name: "dashboard",
			kind: "enyo.Dashboard",
			smallIcon: "icon.png",
			onTap: "notificationTap"
		}
	],
	
	create: function () {
		this.inherited(arguments);
		console.error("Notification created!!");
		
		this.$.dashboard.push({
			title: "System Update available.",
			text: "Tap to open system update app.",
			icon: "icon.png"
		});
	},
	
	notificationTap: function (inSender) {
		console.error("Notification tapped!!!");
		
		if (this.updateResults) {
			this.updateResults.openApp = true;
		} else {
			this.updateResults = {
				openApp: true
			};
		}
			
		enyo.windows.activate("debug.html", "UpdateAppMain", this.updateResults);
	}
});
