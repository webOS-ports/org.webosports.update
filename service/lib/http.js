// Copyright (c) 2026 Herman van Hazendonk
// SPDX-License-Identifier: Apache-2.0

'use strict';

/*
	An HTTP GET as Foundations' AjaxCall made it on node (through the
	launcher's http.createClient stand-in): no redirects followed, any status
	is a result, and the body is parsed as JSON when it is JSON.

	get(url) -> {status, responseText, responseJSON (when JSON), headers},
	or throws an Error with an errorCode:
	- "httpRequest error <message>" (or httpResponse), errorCode the node
	  error's errno (-1 when none): no connection, a reset;
	- "Timeout received from ajaxCall ", 504: no end of the answer within
	  timeoutMs.
*/

const http = require('http');
const https = require('https');
const {err} = require('./mojo');

function createHttp({timeoutMs = 60000} = {}) {
	// AjaxCall kept one timeout for all its requests: a request starting or ending clears it, so
	// a request that hangs while another starts or ends is never timed out (README.md, B10).
	let shared = null;
	const clearShared = () => {
		if (shared) {
			clearTimeout(shared);
			shared = null;
		}
	};
	function get(url) {
		return new Promise((resolve, reject) => {
			let settled = false, response = null;
			const finish = (fn, v) => {
				if (settled) {
					return;
				}
				settled = true;
				fn(v);
			};
			clearShared();
			shared = setTimeout(() => {
				finish(reject, err(504, 'Timeout received from ajaxCall '));
				clearShared();
				if (response) {
					response.removeAllListeners();
					response.destroy();
				}
			}, timeoutMs);
			let req;
			try {
				const parsed = new URL(url);
				const secure = parsed.protocol === 'https:';
				req = (secure ? https : http).request({
					host: parsed.hostname,
					port: parseInt(parsed.port, 10) || (secure ? 443 : 80),
					method: 'GET',
					path: (parsed.pathname || '/') + (parsed.search || ''),
					headers: {
						host: parsed.host,
						'Accept-Encoding': 'identity',
						'Content-Length': 0,
						Accept: '*/*',
						'Content-Type': 'application/x-www-form-urlencoded',
						Date: (new Date()).toUTCString()
					}
				});
			} catch (e) {
				finish(reject, e);
				return;
			}
			req.on('error', e => {
				clearShared();
				finish(reject, err(e.errno, 'httpRequest error ' + e.message));
			});
			req.on('response', res => {
				response = res;
				// Each chunk is decoded by itself, as AjaxCall did (README.md, B9).
				let text = '';
				res.on('data', chunk => {
					text += chunk;
				});
				res.on('error', e => {
					clearShared();
					finish(reject, err(e.errno, 'httpResponse error ' + e.message));
				});
				const done = () => {
					clearShared();
					const result = {status: res.statusCode, responseText: text, headers: res.headers};
					try {
						result.responseJSON = JSON.parse(text);
					} catch (e) {
						// not JSON
					}
					finish(resolve, result);
				};
				res.on('end', done);
				res.on('close', done);
			});
			req.end();
		});
	}
	return {get};
}

module.exports = {createHttp};
