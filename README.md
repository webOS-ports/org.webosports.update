org.webosports.update
=====================

System update service for the LuneOS distribution (webOS Ports):
`org.webosports.service.update`. Only the backend; the Settings app's
Device Info page calls `retrieveVersion`.

It is plain Node 22. run-js-service starts it as it starts any service
directory with a package.json: jsservicelauncher's bootstrap-node.js requires
`service/` and calls `run()`. Until this rewrite it ran on mojoservice and
Foundations (sources.json, services.json, javascript/).

Layout
------

- `service/` is what the recipe installs in
  `/usr/palm/services/org.webosports.service.update`:
  - `service.js`, `package.json`: the entry point;
  - `lib/update.js`: the four commands, step by step as the old assistants;
  - `lib/mojo.js`: replies, bus calls and activities as mojoservice and
    Foundations made them;
  - `lib/bus.js`, `lib/errors.js`: the bus runtime of the cloud connectors
    (by way of org.webosports.messaging and the contacts linker), with this
    service's additions marked `[update]`;
  - `lib/http.js` (the feed), `lib/child.js` (nyx-cmd, script),
    `lib/config.js` (the old config.js values);
  - `start-update.sh`, `run-update.sh`, `download-updates.sh`: unchanged;
  - `activities/`: the periodic check, installed in /etc/palm/activities.
- `files/sysbus/`: the ACG files, unchanged.
- `tests/`: unit tests (`node --test tests/*.test.js`), `run.sh` (the tests,
  then `static-analysis.sh`: jshint, shellcheck, a parse of every module).
  The tests stand in for the bus, the files, nyx-cmd, script and the feed:
  nothing on the host is read, written or run.

What it does
------------

- `retrieveVersion`: the version, build tree, build number and codename in
  /etc/luneos-release. `Rockhopper release 1.0-wrynose-unofficial
  (luneos-Espressino)` gives `{localVersion: "1.0", buildTree: "wrynose",
  buildNumber: "unofficial", codename: "Espressino"}`.
- `checkUpdate`: asks connectionmanager whether the internet is there, reads
  the systemservice preference `updateIgnorePlatformVersion`, the release
  file and the device name (`nyx-cmd DeviceInfo query`), fetches
  `http://build.webos-ports.org/luneos-<tree>/manifest.json` and takes the
  highest version in its changeLog that is for this device (and not above
  the manifest's platformVersion, unless the preference says so). It writes
  what it found to /tmp/checkUpdateResults.json, and when that is newer than
  the local version answers `needUpdate: true` with the changes, and shows a
  toast that opens the Settings app.
- `downloadUpdate` (a subscriber gets the percentage done): looks up the
  image for that device and version in the feed's device-images.json and has
  downloadmanager fetch it to /userdata/luneos-data/system-update.zip.
- `initiateUpdate`: runs start-update.sh (through `script`), which marks the
  next boot as a system update and reboots; run-update.sh does the update in
  that boot.
- The daily check: activitymanager calls `checkUpdate` (the activity in
  `service/activities/`, which configurator creates).

The old service's bugs
----------------------

The first commit of the rewrite keeps all of these, so that an A/B against
the old service could show the two answer the same; the commits after it
mend those marked fixed, one each.

- B1 (fixed) A command's failure went out with `returnValue: true`: the
  commands answer `{returnValue: false, success: false, message}`, and
  mojoservice set returnValue to true on every result. A caller that looks
  at returnValue, as luna-send and QML's `luna.call` do, saw a success.
- B2 (fixed) The daily check ran once per boot. Its complete() restarted the
  activity only when the activity's name was the periodic one's, and took the
  name from Foundations' Activity, which names an adopted activity
  "ActivityManager activity<id>". So it was completed without restart, and
  activitymanager dropped it. On the VM: the callback came at 02:12:56,
  "Completing activity ActivityManager activity15" was logged, and at 10:00
  getDetails for the activity answered "Activity name/creator pair not
  found".
- B3 (fixed) downloadUpdate took any connectionmanager reply with
  returnValue as being online; checkUpdate also asks
  isInternetConnectionAvailable.
- B4 (fixed) initiateUpdate, when start-update.sh failed, answered nothing for
  60 s and then the 504 command timeout: its error handler read `.message`
  of an error that was not there, and threw.
- B5 (fixed) A release file whose codename is empty after its "-"
  (`(luneos-)`) killed the service: `codename[0]` of "" threw in a file
  callback nothing caught. The caller got no answer.
- B6 (fixed) A results file that is not JSON killed the service the same way,
  in downloadUpdate.
- B7 downloadUpdate without a subscription answers 504 after 60 s while the
  download goes on: only a reply to a subscription stops the command's clock.
  Kept.
- B8 A subscription to downloadUpdate stays open after its result, and the
  service stays up with it, until the caller cancels it. Kept, as
  mojoservice did it.
- B9 (fixed) The feed's answer was decoded chunk by chunk, so a character cut
  between two chunks came out as U+FFFD (a manifest's change text that is not
  ASCII, past the first chunk).
- B10 (fixed) Foundations' AjaxCall had one timeout for all its requests: a
  request starting or ending cleared it, so a request that hangs while
  another one (a downloadUpdate during a checkUpdate) starts or ends was never
  timed out, and its command waited for the 504.
- B11 Versions are compared as JavaScript compares them: the release file's is
  a string ("1.0") and compares with a number as a number, but two strings
  ("10" and "9") compare as text. The feed's manifest has numbers, as far as
  tests/manifest.json shows; kept.
- B12 The toast opens the Settings app with `page: "SystemUpdates"`; the QML
  Settings app has no such page. Not this service's to change.
- B13 checkUpdate writes /tmp/checkUpdateResults.json also when there is no
  update (with the local version). Harmless; kept.

Deliberately different from the old service
-------------------------------------------

- mojoservice made an activity for every call that brought none
  (`checkUpdate_0`, ...) and completed it after; nothing came of them but
  activitymanager traffic, and a killed service left them behind. Not made.
- mojoservice answered an activitymanager callback twice: `{returnValue:
  true}` when it adopted the activity, and the result after. The hub drops the
  second (the call has had its reply); it is not sent.
- mojoservice's `__info`, `__quit` and `__gc` methods are gone; bus.js has
  `info` and `quit`.
- The unused javascript/utils/parser.js (opkg output parsing) and the
  never-called ActivityHelper.createActivity and checkActivity are gone.
- A URL with a port is fetched from that host and port; the launcher's
  stand-in for http.createClient looked up "host:port" as a host name. The
  feed's URLs have no port.

How it was checked
------------------

- An A/B of the old service, run unchanged on the host on the VM's
  frameworks (mojoservice, Foundations, and the launcher's http.createClient
  stand-in), against this one, on generated scenarios: release files of every
  shape, the network up or down, preferences, nyx-cmd answering, failing or
  missing, the feed answering, failing, hanging, cut or not JSON, results
  files, downloadmanager progress and failures, script succeeding, failing or
  missing, and calls with no activity, from activitymanager (adopt) and from
  an app (monitor). Every reply, every bus call, every feed file fetched, the
  results file and script's arguments are compared.
- On the qemux86-64 VM, the stock service and this one side by side; the
  commit messages give the numbers.

Licence
-------

Apache License 2.0; see COPYING.
