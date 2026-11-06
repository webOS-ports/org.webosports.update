// Copyright (c) 2026 Herman van Hazendonk
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

/*
	The activities configurator creates from service/activities/ at every boot
	(it keeps no record of activities it made, so each file is sent to
	activitymanager again, and "replace" swaps the old one out).

	- The periodic check: every 12 hours. An interval that is not "precise" is
	  aligned to fixed tick points rather than counted from its creation, so
	  being replaced at boot does not push it back.
	- The boot check: no schedule, so it runs as soon as its requirement (the
	  internet) is met, and not persistent, so once completed it is gone until
	  configurator makes it again at the next boot.
*/

const {describe, it} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {ACTIVITY_NAME} = require('../service/lib/update');

const DIR = path.join(__dirname, '../service/activities/org.webosports.service.update');
const read = name => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));

describe('the activities', () => {
	const periodic = read('org.webosports.service.update.check');
	const atBoot = read('org.webosports.service.update.bootcheck');

	it('are the only files there, and both call checkUpdate when the internet is up', () => {
		assert.deepEqual(fs.readdirSync(DIR).sort(),
			['org.webosports.service.update.bootcheck', 'org.webosports.service.update.check']);
		for (const a of [periodic, atBoot]) {
			assert.equal(a.activity.callback.method, 'luna://org.webosports.service.update/checkUpdate');
			assert.equal(a.activity.requirements.internet, true);
			assert.equal(a.start, true);
			assert.equal(a.replace, true);
		}
	});

	it('the periodic one runs every 12 hours, under the name the service restarts', () => {
		assert.equal(periodic.activity.name, ACTIVITY_NAME);
		assert.deepEqual(periodic.activity.schedule, {interval: '12h', precise: false});
		assert.equal(periodic.activity.type.persist, true);
	});

	it('the boot one has no schedule, does not persist, and has a name of its own', () => {
		assert.notEqual(atBoot.activity.name, ACTIVITY_NAME);
		assert.equal(atBoot.activity.schedule, undefined);
		assert.equal(atBoot.activity.type.persist, false);
	});
});
