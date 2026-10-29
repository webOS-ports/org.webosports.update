// Copyright (c) 2026 Herman van Hazendonk
// SPDX-License-Identifier: Apache-2.0

/*
	A stand-in palmbus for running the service on the host: outgoing calls go
	to onCall(uri, args, sender) -> a reply, an array of replies (a promise in
	it is a reply sent when it resolves), or undefined (never replies);
	request() delivers a call to a registered service, and cancel() cancels a
	subscription to it, as a caller dropping it would.
*/
'use strict';

const {EventEmitter} = require('events');

function createPalmbus(onCall) {
	const services = {};
	let token = 0;

	function Handle(name) {
		EventEmitter.call(this);
		this.name = name || '';
		this.methods = [];
		this.subscriptions = [];
		if (name) {
			services[name] = this;
		}
	}
	Object.setPrototypeOf(Handle.prototype, EventEmitter.prototype);
	Handle.prototype.registerMethod = function (category, method) {
		this.methods.push((category || '/') + method);
	};
	Handle.prototype.subscriptionAdd = function (key) {
		this.subscriptions.push(key);
	};
	Handle.prototype.unregister = function () {
		this.unregistered = true;
	};
	Handle.prototype.pushRole = function () {};
	Handle.prototype.call = function (uri, payload) {
		const req = new EventEmitter();
		const args = JSON.parse(payload);
		req.cancel = function () {
			req.cancelled = true;
		};
		const self = this;
		setImmediate(async function () {
			let r;
			try {
				r = await onCall(uri, args, self.name);
			} catch (e) {
				r = {returnValue: false, errorCode: -1, errorText: String(e && e.stack || e)};
			}
			if (r === undefined) {
				return;
			}
			for (const next of Array.isArray(r) ? r : [r]) {
				const one = await next;
				if (req.cancelled) {
					return;
				}
				req.emit('response', {payload: () => JSON.stringify(one)});
			}
		});
		return req;
	};
	Handle.prototype.subscribe = Handle.prototype.call;

	/*
		A call to the service registered as name: -> {first, replies, token}:
		first resolves with its first reply (parsed), replies holds every
		reply so far.
	*/
	function request(name, method, payload, caller = {}) {
		const h = services[name];
		if (!h) {
			throw new Error('no service ' + name);
		}
		token++;
		const t = String(token);
		const replies = [];
		let resolveFirst;
		const first = new Promise(resolve => {
			resolveFirst = resolve;
		});
		h.emit('request', {
			method: () => method,
			category: () => '/',
			payload: () => JSON.stringify(payload || {}),
			uniqueToken: () => t,
			applicationID: () => caller.appId || '',
			senderServiceName: () => caller.service || '',
			respond: text => {
				replies.push(JSON.parse(text));
				if (replies.length === 1) {
					resolveFirst(replies[0]);
				}
				return true;
			}
		});
		return {first, replies, token: t};
	}

	function cancel(name, t) {
		services[name].emit('cancel', {uniqueToken: () => t});
	}

	return {Handle, services, request, cancel, setAppId() {}};
}

module.exports = {createPalmbus};
