// Copyright (c) 2026 Herman van Hazendonk
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

/*
	Who may call the service. Its commands are in the group
	update-service.operation (files/sysbus/*.api.json); the group's trust
	level in groups.json is what a caller must have. "dev" is the lowest:
	any app or service granted the group, signed or not, could start a
	download and reboot the device into the update. "oem" lets through only
	callers of oem trust: the Settings app's pages, activitymanager (the
	activities' callbacks) and the system's own services.
*/

const {describe, it} = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const SYSBUS = path.join(__dirname, '..', 'files', 'sysbus');
const read = name => require(path.join(SYSBUS, 'org.webosports.service.update.' + name + '.json'));

describe('the bus permissions', () => {
	it('put every command in update-service.operation', () => {
		const api = read('api');
		assert.deepEqual(Object.keys(api), ['update-service.operation']);
		for (const m of ['checkUpdate', 'downloadUpdate', 'initiateUpdate', 'retrieveVersion']) {
			assert.ok(api['update-service.operation'].some(p => p === 'org.webosports.service.update/' + m ||
				p === 'org.webosports.service.update/*'), m);
		}
	});
	it('give that group to callers of oem trust only', () => {
		assert.deepEqual(read('groups')['update-service.operation'], ['oem']);
	});
});
