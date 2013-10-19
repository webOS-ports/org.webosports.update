var Config = {
	manifestUrl: "http://build.webos-ports.org/webos-ports-staging/latest/manifest.json",
	//versionFile: "/etc/platform-version",
	versionFile: "/media/internal/platform-version",
	interval: "24h",
	destinationDir: "/media/internal/.upgrade-storage/",
	preDowlonloadComman: "opkg update",
	downloadCommand: "opkg upgrade --download-only --cache /media/internal/.upgrade-storage"
};