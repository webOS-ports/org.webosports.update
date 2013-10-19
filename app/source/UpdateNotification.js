/*jslint sloppy: true */
/*global enyo, console, UpdateApp, document */

enyo.kind({
	name: "UpdateNotification",
	published: {
		updateResults: null
	},
	components: [
		{
			kind: "enyo.Dashboard",
			layers: [
				{ icon: "icon.png", title: "Update available.", text: "Update available." }
			],
			smallIcon: "icon.png",
			onTap: "notificationTap"
		}
	],
	
	notificationTap: function (inSender) {
		var updateApp = new UpdateApp();
		updateApp.renderInto(document.body);
		updateApp.setUpdateResults(this.updateResults);
		//enyo.windows.activate
	}
});