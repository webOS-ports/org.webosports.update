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
	function get(url) {
		return new Promise((resolve, reject) => {
			let settled = false, response = null;
			// Each request has its own timeout. AjaxCall kept one for all its requests, which a request
			// starting or ending cleared, so a request that hung while another started or ended was
			// never timed out (README.md, B10).
			let timer = null;
			const finish = (fn, v) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				fn(v);
			};
			timer = setTimeout(() => {
				finish(reject, err(504, 'Timeout received from ajaxCall '));
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
				finish(reject, err(e.errno, 'httpRequest error ' + e.message));
			});
			req.on('response', res => {
				response = res;
				// The body is decoded once it is all there. AjaxCall decoded each chunk by itself, so a
				// character cut between two chunks came out as U+FFFD (README.md, B9).
				const chunks = [];
				res.on('data', chunk => {
					chunks.push(chunk);
				});
				res.on('error', e => {
					finish(reject, err(e.errno, 'httpResponse error ' + e.message));
				});
				const done = () => {
					const text = Buffer.concat(chunks).toString('utf8');
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
