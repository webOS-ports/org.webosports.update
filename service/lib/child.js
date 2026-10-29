// Copyright (c) 2026 Herman van Hazendonk
// Derived from the old service's javascript/utils/utils.js, Copyright (c)
// 2013-2016 Achim Königs, (c) 2019-2023 Herman van Hazendonk, licensed under the
// Apache License, Version 2.0.
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

/*
	run(command, onOutput): starts command ({cmd, args, options}) as the old
	Utils.spawnChild did, and gives the first of what ends it:
	{finished, error: <exit code not 0>, code} when it closes, or
	{finished, error: true, errorObj} when it cannot be started (node sends
	"error" and then "close" for that; the first counts). onOutput({msg, type})
	gets its output, "out" or "err"; without it the output is logged.
*/

const childProcess = require('child_process');

function createChild({spawn = childProcess.spawn, log = console} = {}) {
	function run(command, onOutput) {
		return new Promise(resolve => {
			const child = spawn(command.cmd, command.args, command.options);
			const output = type => data => {
				if (typeof onOutput === 'function') {
					onOutput({msg: data.toString(), type});
				} else {
					log.log('Child-' + type + ': ' + data.toString());
				}
			};
			child.stdout.on('data', output('out'));
			child.stderr.on('data', output('err'));
			child.on('close', code => resolve({finished: true, error: code !== 0, code}));
			child.on('error', e => {
				log.log('Error in spawning child: ' + e.message);
				resolve({finished: true, error: true, errorObj: e});
			});
		});
	}
	return {run};
}

module.exports = {createChild};
