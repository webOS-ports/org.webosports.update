// SPDX-License-Identifier: GPL-3.0-or-later
/* Copied from luneos-synergy-connectors cloud/_core/service/_cloudcore/node/bus.js at a3139d0, the
 * runtime of the cloud connectors, by way of org.webosports.messaging and
 * com.palm.service.contacts.linker (app-services PR #29); keep them in step. The additions marked
 * [linker] are the linker's: a method with `raw: true` replies its handler's value unchanged,
 * ctx.replyNow, and subscribe(). Those marked [update] are this service's: a method with
 * `subscribe: true` takes subscriptions (ctx.push, ctx.onCancel), and call()/subscribe() with
 * `raw: true` hand back the reply as it came, a returnValue:false one included. */
/* bus.js - the connector on the luna bus, through palmbus directly.
 *
 * As Documents' own service does (org.webosports.app.documents.service), and not through
 * webos-service: that one creates an activity for every call, and a call waits forever when the
 * activity manager refuses it. The service exits after an idle time; the bus starts it again on
 * the next call.
 *
 *   const bus = createBus({ palmbus, name });
 *   bus.serve({ listFolder: { allow: ["org.webosports.app.documents"], timeoutMs: 60000,
 *                             handler: async (params, ctx) => ({ entries }) } });
 *   await bus.call("luna://com.palm.service.accounts/readCredentials", { accountId });
 *
 * Every request gets exactly one reply, whatever the handler does: its return value with
 * returnValue:true, or what it threw (errors.toReply), or TIMEOUT when it has not settled by
 * the method's deadline. The payload must be a JSON object. A method's `allow` is a list of
 * caller globs (* ? as in the account templates, as acl.js matched them); none means open.
 * `quit` and `info` are there for the installer, which asks a service to quit before an update.
 */
"use strict";

const { CloudError, toReply, isUnexpected } = require("./errors.js");

const IDLE_MS = 30000;
const CALL_TIMEOUT_MS = 30000;
const METHOD_TIMEOUT_MS = 60000;

// The caller of an incoming message, as com.palm.service.accounts and acl.js take it: the app id
// (a WAM app's comes as "<appid> <pid>"), or else the calling service's name; "" for neither
// (a raw luna-send from a shell).
function callerId(msg) {
	let id = "";
	try { id = msg.applicationID() || msg.senderServiceName() || ""; }
	catch (e) { id = ""; }
	return String(id).split(" ")[0];
}

// Template glob: * any run, ? one character, everything else literal.
function globMatch(glob, id) {
	const re = String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
	return new RegExp("^" + re + "$").test(id);
}

function permitted(allow, caller) {
	if (!allow || !allow.length) { return true; }
	return allow.some((g) => globMatch(g, caller));
}

function decodePayload(text) {
	let p;
	try { p = JSON.parse(text || "{}"); }
	catch (e) { throw new CloudError("BAD_ARGS", "the payload is not JSON"); }
	if (!p || typeof p !== "object" || Array.isArray(p)) {
		throw new CloudError("BAD_ARGS", "the payload must be a JSON object");
	}
	return p;
}

function createBus({ palmbus, name, idleMs = IDLE_MS, callTimeoutMs = CALL_TIMEOUT_MS,
	exit = (code) => process.exit(code), log = console } = {}) {
	const handle = new palmbus.Handle(name);
	let methods = {};
	let inflight = 0;
	let idle = null;
	let stopped = false;
	// [update] The subscribed calls in flight, by their message's uniqueToken: what to do on cancel.
	const subscriptions = {};

	// The idle clock runs only while no request is being worked on: an upload can take minutes.
	// Leaving must not drop a request the hub is already sending us, or its caller gets "Message
	// status unknown". palmbus hands bus messages over from a libuv check handle (after the poll),
	// so the exit is decided in the next turn's timers, after any message read in this one was
	// dispatched, and called off if one came in. Then the name is given back to the hub at once
	// (unregister), so it starts a new instance for the next request instead of routing it to a
	// process that is still tearing down; the process exits after that.
	let generation = 0;
	function leave(code, why) {
		log.log(name + ": " + why + ", exiting");
		try { if (typeof handle.unregister === "function") { handle.unregister(); } }
		catch (e) { log.error(name + ": unregister failed: " + ((e && e.message) || e)); }
		exit(code);
	}
	function touch() {
		generation++;
		if (idle) { clearTimeout(idle); idle = null; }
		if (stopped || inflight > 0 || !idleMs) { return; }
		const mine = generation;
		idle = setTimeout(() => {
			idle = setTimeout(() => {
				idle = null;
				if (mine !== generation || stopped || inflight > 0) { return; }
				leave(0, "idle");
			}, 0);
		}, idleMs);
	}

	function builtin(method) {
		if (method === "info") {
			return { handler: () => ({ id: name, methods: Object.keys(methods).concat(["quit", "info"]) }) };
		}
		if (method === "quit") {
			return { handler: () => { setTimeout(() => leave(0, "asked to quit"), 200); return { status: "quitting" }; } };
		}
		return null;
	}

	async function dispatch(msg) {
		inflight++;
		touch();
		let done = false, deadline = null, early = false;
		// [update] A subscribed call stays open after a reply that is not an error, as mojoservice
		// kept it, until its caller cancels it.
		let subscribed = false, cancelled = false, closed = false, onCancel = null, key = null;
		const respond = (obj) => {
			let text;
			try { text = JSON.stringify(obj); }
			catch (e) { text = JSON.stringify(toReply(e)); }
			try { msg.respond(text); }
			catch (e) { log.error(name + ": respond failed: " + ((e && e.message) || e)); }
		};
		const finish = () => {
			if (closed) { return; }
			closed = true;
			if (key !== null) { delete subscriptions[key]; }
			inflight--;
			touch();
		};
		const send = (obj) => {
			if (done) { return; }
			done = true;
			if (deadline) { clearTimeout(deadline); }
			// [update] A subscribed call gets the result after an early reply too, as mojoservice sent it.
			if ((!early || subscribed) && !cancelled) { respond(obj); }
			if (subscribed && !cancelled && !(obj && obj.returnValue === false)) { return; }
			finish();
		};
		// [update] A further reply to a subscribed call; false when it can take none.
		const push = (obj) => {
			if (!subscribed || cancelled || closed) { return false; }
			respond(obj);
			return true;
		};
		// [linker] Reply now and go on working: the request stays in flight (no idle exit) until the
		// handler ends, and what it returns then is not sent.
		const replyNow = (obj) => {
			if (done || early) { return; }
			early = true;
			respond(obj);
		};
		let method = "?";
		try {
			method = String(msg.method());
			const spec = (Object.prototype.hasOwnProperty.call(methods, method) && methods[method]) || builtin(method);
			if (!spec) { throw new CloudError("NOT_SUPPORTED", "unknown method " + method); }
			const caller = callerId(msg);
			if (!permitted(spec.allow, caller)) {
				log.log(name + ": " + method + " denied caller '" + caller + "'; allows " + spec.allow.join(","));
				throw new CloudError("PERMISSION_DENIED", "caller '" + caller + "' is not permitted to call this method");
			}
			const params = decodePayload(msg.payload());
			if (spec.subscribe && params.subscribe) {
				subscribed = true;
				try { key = String(msg.uniqueToken()); } catch (e) { key = null; }
				if (key !== null) {
					subscriptions[key] = () => {
						if (cancelled) { return; }
						cancelled = true;
						if (onCancel) { try { onCancel(); } catch (e) { log.error(name + ": " + method + " cancel: " + ((e && e.message) || e)); } }
						if (done) { finish(); }
					};
					try { handle.subscriptionAdd(key, msg); } catch (e) { log.error(name + ": subscriptionAdd failed: " + ((e && e.message) || e)); }
				}
			}
			const ms = spec.timeoutMs || METHOD_TIMEOUT_MS;
			deadline = setTimeout(() => {
				log.error(name + ": " + method + " did not finish in " + ms + " ms");
				send({ returnValue: false, errorCode: "TIMEOUT", errorText: method + " timed out after " + Math.round(ms / 1000) + " s" });
			}, ms);
			let sender = "";
			try { sender = String(msg.senderServiceName() || ""); } catch (e) { sender = ""; }
			const out = await spec.handler(params, { caller, sender, method, call: bus.call, replyNow, subscribed, push,
				onCancel: (fn) => { onCancel = fn; }, get cancelled() { return cancelled; } });
			// [linker] A raw method replies its value as it is (see mojo.js).
			if (spec.raw) { send(out); return; }
			const reply = Object.assign({ returnValue: true }, (out && typeof out === "object") ? out : {});
			reply.returnValue = true;
			send(reply);
		} catch (e) {
			const reply = toReply(e);
			if (isUnexpected(e)) { log.error(name + ": " + method + " threw: " + ((e && e.stack) || e)); }
			else { log.log(name + ": " + method + " failed: " + reply.errorCode + ": " + reply.errorText); }
			send(reply);
		}
	}

	const bus = {
		handle,

		// Register `methods` ({ name: { handler, allow?, timeoutMs? } }) and start answering.
		serve(table) {
			methods = Object.assign({}, table);
			for (const m of Object.keys(methods).concat(["quit", "info"])) { handle.registerMethod("/", m); }
			handle.addListener("request", (msg) => { dispatch(msg); });
			// [update] A caller cancelling its subscription.
			handle.addListener("cancel", (msg) => {
				let k = null;
				try { k = String(msg.uniqueToken()); } catch (e) { k = null; }
				if (k !== null && subscriptions[k]) { subscriptions[k](); }
			});
			touch();
			return bus;
		},

		// One call to another service: the parsed reply, or a CloudError carrying the reply's
		// errorCode when it says returnValue:false. No reply within timeoutMs is BUS_TIMEOUT.
		call(uri, args, { timeoutMs = callTimeoutMs, raw = false } = {}) {
			return new Promise((resolve, reject) => {
				let req = null, settled = false;
				const finish = (fn, v) => { if (settled) { return; } settled = true; clearTimeout(timer); fn(v); };
				// [update] timeoutMs 0: wait as long as it takes, as PalmCall did.
				const timer = timeoutMs ? setTimeout(() => {
					finish(reject, new CloudError("BUS_TIMEOUT", uri + ": no reply in " + timeoutMs + " ms"));
					try { if (req && typeof req.cancel === "function") { req.cancel(); } } catch (e) { /* gone already */ }
				}, timeoutMs) : null;
				try {
					req = handle.call(uri, JSON.stringify(args || {}));
					req.addListener("response", (m) => {
						let r;
						try { r = JSON.parse(m.payload()); }
						catch (e) { finish(reject, new CloudError("BUS_BAD_REPLY", uri + ": reply is not JSON")); return; }
						if (raw) { finish(resolve, r); return; }
						if (!r || typeof r !== "object" || r.returnValue === false) {
							const code = (r && r.errorCode !== undefined && r.errorCode !== null) ? r.errorCode : "BUS_ERROR";
							finish(reject, new CloudError(code, (r && r.errorText) || (uri + " failed")));
							return;
						}
						finish(resolve, r);
					});
				} catch (e) {
					finish(reject, new CloudError("BUS_ERROR", uri + ": " + ((e && e.message) || e)));
				}
			});
		},

		// [linker] A subscription: { first, cancel } once its first reply is in (first, the
		// parsed reply; rejected as call() rejects). The replies after it go to onEvent, parsed
		// ({} if not JSON). cancel() ends it.
		subscribe(uri, args, { timeoutMs = callTimeoutMs, onEvent, raw = false } = {}) {
			return new Promise((resolve, reject) => {
				let req = null, settled = false;
				const cancel = () => { try { if (req && typeof req.cancel === "function") { req.cancel(); } } catch (e) { /* gone already */ } };
				const finish = (fn, v) => { if (settled) { return; } settled = true; clearTimeout(timer); fn(v); };
				const timer = timeoutMs ? setTimeout(() => {
					finish(reject, new CloudError("BUS_TIMEOUT", uri + ": no reply in " + timeoutMs + " ms"));
					cancel();
				}, timeoutMs) : null;
				try {
					req = handle.subscribe ? handle.subscribe(uri, JSON.stringify(args || {})) : handle.call(uri, JSON.stringify(args || {}));
					req.addListener("response", (m) => {
						let r;
						try { r = JSON.parse(m.payload()); }
						catch (e) {
							if (settled) { if (onEvent) { onEvent({}); } return; }
							finish(reject, new CloudError("BUS_BAD_REPLY", uri + ": reply is not JSON")); cancel(); return;
						}
						if (settled) { if (onEvent) { onEvent(r && typeof r === "object" ? r : {}); } return; }
						if (raw) { finish(resolve, { first: r, cancel }); return; }
						if (!r || typeof r !== "object" || r.returnValue === false) {
							const code = (r && r.errorCode !== undefined && r.errorCode !== null) ? r.errorCode : "BUS_ERROR";
							finish(reject, new CloudError(code, (r && r.errorText) || (uri + " failed")));
							cancel();
							return;
						}
						finish(resolve, { first: r, cancel });
					});
				} catch (e) {
					finish(reject, new CloudError("BUS_ERROR", uri + ": " + ((e && e.message) || e)));
				}
			});
		},

		// Tests: stop the idle clock.
		stop() { stopped = true; if (idle) { clearTimeout(idle); idle = null; } },

		get inflight() { return inflight; },
	};
	return bus;
}

module.exports = { createBus, callerId, globMatch, permitted, decodePayload, IDLE_MS };
