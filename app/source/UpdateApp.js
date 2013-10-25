/*jslint sloppy: true */
/*global enyo, console*/

enyo.kind({
	name: "UpdateApp",
	kind: "FittableRows",
	fit: true,
	currentRequest: false,
	published: {
		updateResults: null
	},
	components: [
		//service caller:
		{
			name: "updateService",
			kind: "enyo.PalmService",
			service: "palm://org.webosports.service.update",
			method: "checkUpdate",
			subscribe: false,
			onComplete: "updateChecked"
		},
		{
			name: "downloadService",
			kind: "enyo.PalmService",
			service: "palm://org.webosports.service.update",
			method: "downloadUpdate",
			subscribe: true,
			//resubscribe: true, //not sure what that really means.
			onComplete: "downloadComplete"
		},
		{
			name: "initiateService",
			kind: "enyo.PalmService",
			service: "palm://org.webosports.service.update",
			method: "initiateUpdate",
			subscribe: false,
			onComplete: "initiateUpdateComplete"
		},
		
		//ui components:
		{kind: "onyx.Toolbar", content: "System Update", classes: "center"},
		
		//display status information and change log:
		{
			name: "statusDisplay",
			classes: "nice-padding center",
			fit: false,
			content: "Please check for updates"
		},
		{
			kind: "enyo.Scroller",
			fit: true,
			touch: true,
			components: [
				{name: "spinner", kind: "onyx.Spinner", showing: false, classes: "center"},
				{name: "changesDisplay", classes: "nice-padding", allowHtml: true}
			]
		},
			
		//buttons:
		{name: "toolbarControls", kind: "onyx.Toolbar", classes: "center", components: [
			{
				kind: "onyx.Button",
				name: "btnCheck",
				content: "Check for updates",
				ontap: "doCheck"
			},
			{
				kind: "onyx.Button",
				name: "btnDownload",
				classes: "onyx-affirmative",
				content: "Download System Update",
				ontap: "doDownload",
				showing: false
			},
			{
				kind: "onyx.Button",
				name: "btnInitiateUpdate",
				classes: "onyx-affirmative",
				content: "Install System Update",
				ontap: "doInstall",
				showing: false
			}
		]},
		
		//application events:
		{
			kind: enyo.ApplicationEvents,
			onWindowParamsChange: "windowParamsChangeHandler",
			onApplicationRelaunch: "relaunched"
		}
	],
	
	//application event callbacks:
	windowParamsChangeHandler: function () {
		console.error("New params: " + JSON.stringify(enyo.windowParams));
		this.setUpdateResults(enyo.windowParams);
	},
	
	relaunched: function () {
		console.error("Relaunched!");
		enyo.windows.activate("debug.html", "UpdateAppMain");
	},
	
	//button callbacks:
	doCheck: function (inSender, inEvent) {
		this.currentRequest = this.$.updateService.send({});
		this.startActivity("Checking remote plattform version...");
	},
	doDownload: function (inSender, inEvent) {
		this.currentRequest = this.$.downloadService.send({});
		this.startActivity("Starting to download system update...");
	},
	doInstall: function (inSender, inEvent) {
		this.currentRequest = this.$.initiateService.send({});
		this.startActivity("Initiating reboot into system update state.");
	},
	
	//helper methods:
	startActivity: function (msg) {
		this.$.toolbarControls.hide();
		this.$.changesDisplay.hide();
		this.$.spinner.show();
		this.$.spinner.start();
		if (msg) {
			this.updateStatus(msg);
		}
	},
	stopActivity: function () {
		if (this.currentRequest) {
			this.currentRequest.cancel();
		}
		this.$.toolbarControls.show();
		this.$.changesDisplay.show();
		this.$.spinner.hide();
		this.$.spinner.stop();
	},
	
	updateStatus: function (msg) {
		this.$.statusDisplay.setContent(msg);
		this.resized();
	},
	
	//service callbacks:
	updateChecked: function (inSender, inEvent) {
		var result = inEvent.data;
		this.stopActivity();
		
		this.setUpdateResults(result);
	},
	
	downloadComplete: function (inSender, inEvent) {
		var result = inEvent.data;
		
		console.error("Got: " + JSON.stringify(result));
		if (result.error) { //had error. Download aborted or something...
			this.stopActivity();
			this.updateStatus("Error downloading updates: " + result.msg);
		} else if (result.finished) { //finished downloading
			this.stopActivity();
			this.updateStatus("Downloading finished");
			this.$.btnInitiateUpdate.show();
			this.$.btnDownload.hide();
		} else { //only some status from service:
			this.updateStatus("Downloaded " + result.numDownloaded + " of " + result.totalDownload + " packages.");
		}
	},
	
	initiateUpdateComplete: function (inSender, inEvent) {
		var result = inEvent.data;
		
		this.stopActivity();
		if (result.success) { //had error. Download aborted or something...
			this.updateStatus("Successful initiated update. System will now reboot and update.");
		} else { //only some status from service:
			this.updateStatus("Error, could not initiate Update: " + result.msg);
		}
	},
	
	setUpdateResults: function (result) {
		this.$.changesDisplay.setContent("");
		
		if (result && result.success) {
			if (result.needUpdate) {
				this.updateStatus("An update is available.");
				
				enyo.forEach(result.changesSinceLast, function processChange(change) {
					var content = [
						"<p><strong>Version: ", change.version, "</strong></p>"
					], i;
					
					for (i = 0; i < change.changes.length; i += 1) {
						content.push(change.changes[i]);
						content.push("<br>");
					}
					
					content.push("<hr>");
					
					this.$.changesDisplay.addContent(content.join(""));
				}, this);
				
				this.$.btnDownload.show();
				this.$.btnCheck.hide();
			} else {
				this.updateStatus("Your system is up to date.");
			}
		} else if (result && (result.success === false || result.returnValue === false)) {
			this.updateStatus("Could not check for updates: " + (result.message || result.errorText || "no error speficied."));
		}
	}
});
