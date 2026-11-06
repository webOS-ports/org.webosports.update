// Copyright (c) 2026 Herman van Hazendonk
// Derived from Foundations' comms/ajaxcall.js, Copyright (c) 2009-2012
// Hewlett-Packard Development Company, L.P., licensed under the Apache License,
// Version 2.0.
// SPDX-License-Identifier: GPL-3.0-or-later

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
	  timeoutMs;
	- "Response too large", 413: more than maxBytes of body. The service only
	  fetches the feed's small JSON files; a feed that went wrong, or was made
	  to, could otherwise send it a body until it ran out of memory.
*/

const http = require('http');
const https = require('https');
const {err} = require('./mojo');

// Far above what manifest.json and device-images.json will grow to.
const MAX_BYTES = 1024 * 1024;

function createHttp({timeoutMs = 60000, maxBytes = MAX_BYTES} = {}) {
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
				let received = 0;
				const tooLarge = () => {
					finish(reject, err(413, 'Response too large'));
					res.removeAllListeners();
					res.destroy();
				};
				res.on('data', chunk => {
					received += chunk.length;
					if (received > maxBytes) {
						tooLarge();
						return;
					}
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

module.exports = {createHttp, MAX_BYTES};
