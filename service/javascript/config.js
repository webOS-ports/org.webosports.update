var Config = {
	manifestUrl: "http://build.webos-ports.org/webos-ports-staging/latest/manifest.json",
	versionFile: "/etc/platform-version",
	preDowlonloadComman: "opkg update",
	downloadCommand: "opkg upgrade --download-only --cache /media/internal/.upgrade-storage"
};