// Copyright (c) 2026 Herman van Hazendonk
// Derived from mojoservice, Copyright 2009-2011 Hewlett-Packard Development
// Company, L.P., and Foundations' comms/palmcall.js and control/activity.js,
// Copyright (c) 2009-2012 Hewlett-Packard Development Company, L.P., licensed
// under the Apache License, Version 2.0.
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

/*
	What mojoservice and Foundations did around the commands, kept as they did
	it for the service's callers (the Settings app, activitymanager, a shell):

	- a command's result goes out with returnValue:true set on it, unless it
	  says returnValue:false: the commands answer their own failures so.
	  mojoservice sent those with returnValue:true as well (README.md, B1)
	- a reply to a subscription goes out with returnValue:true and fired:true
	- an error as {errorText, errorCode, exception, returnValue:false}: with
	  no errorCode of its own, -9999 and "MojoService: no errorCode
	  supplied " before its text
	- a command still running after its timeout: error 504,
	  "commandTimeout in org.webosports.service.update/<command>"; a reply to
	  a subscription stops that clock
	- a bus call fails as PalmCall failed: on a reply with returnValue:false,
	  or with any errorCode or errorText, as an Error whose message is
	  "<uri> <args>: <errorText>" and whose errorCode is the reply's (or -1)
	- an $activity in the call is taken on before the command runs, and let
	  go of after its reply (Activity below)
*/

const DEFAULT_TIMEOUT_S = 60;
// Foundations' Activity called it so, palm:// and all; the hub takes it.
const AM = 'palm://com.palm.activitymanager';
// A bus call waits as long as PalmCall did: there was no limit (bus.js: timeoutMs 0).
const NO_LIMIT = 0;

// A callback from activitymanager: the legacy name, the OSE one, or its proxy for the creator.
function fromActivityManager(sender) {
	return sender === 'com.palm.activitymanager' || sender === 'com.webos.service.activitymanager' ||
		/_com\.webos\.service\.activitymanager_proxy$/.test(sender || '');
}

function reply(result) {
	const out = result || {};
	if (typeof out === 'object') {
		out.returnValue = out.returnValue !== false;
	}
	return out;
}

function subscriptionReply(result) {
	const out = result || {};
	out.returnValue = true;
	out.fired = true;
	return out;
}

function exception(e) {
	const out = {
		errorText: e && e.message,
		errorCode: e && e.errorCode,
		exception: e && e.stack ? e.stack : String(e),
		returnValue: false
	};
	if (out.errorCode === undefined) {
		out.errorCode = -9999;
		out.errorText = 'MojoService: no errorCode supplied ' + (out.errorText || '');
	}
	return out;
}

// Foundations' Err.create: an Error with an errorCode (-1 when none).
function err(errorCode, message, innerError) {
	const e = new Error(message);
	e.errorCode = errorCode !== undefined ? errorCode : -1;
	if (innerError !== undefined) {
		e.innerError = innerError;
	}
	return e;
}

// Err's toString: "Error: <message>", and the inner error's after "; inner".
function errString(e) {
	const one = x => 'Error: ' + (x && x.message ? x.message : JSON.stringify(x));
	return one(e) + (e && e.innerError ? '; inner' + one(e.innerError) : '');
}

function failed(payload) {
	return !payload || typeof payload !== 'object' || payload.returnValue === false || !!payload.errorCode || !!payload.errorText;
}

function palmError(uri, args, payload) {
	const p = payload && typeof payload === 'object' ? payload : {};
	const e = err(p.errorCode || -1, uri + ' ' + JSON.stringify(args) + ': ' + (p.errorText || 'Unknown PalmCall failure'),
		p.exception);
	e.response = payload;
	return e;
}

// PalmCall's url + cmd: a "/" between them unless the url ends with one.
function join(url, cmd) {
	if (!cmd) {
		return url;
	}
	return (url.charAt(url.length - 1) === '/' ? url : url + '/') + cmd;
}

/*
	PalmCall on the bus: call(url, cmd, args) -> the reply, or throws as
	PalmCall did. subscribe(url, cmd, args, onReply): each reply, in turn, as
	onReply(error, reply); -> cancel().
*/
function createPalm(bus) {
	async function call(url, cmd, args) {
		const uri = join(url, cmd);
		const r = await bus.call(uri, args, {raw: true, timeoutMs: NO_LIMIT});
		if (failed(r)) {
			throw palmError(uri, args, r);
		}
		return r;
	}
	function subscribe(url, cmd, args, onReply) {
		const uri = join(url, cmd);
		let cancel = null, cancelled = false;
		const each = r => {
			if (cancelled) {
				return;
			}
			if (failed(r)) {
				onReply(palmError(uri, args, r));
			} else {
				onReply(null, r);
			}
		};
		bus.subscribe(uri, args, {raw: true, timeoutMs: NO_LIMIT, onEvent: each}).then(held => {
			cancel = held.cancel;
			if (cancelled) {
				cancel();
				return;
			}
			each(held.first);
		}, e => {
			if (!cancelled) {
				onReply(e);
			}
		});
		return () => {
			cancelled = true;
			if (cancel) {
				cancel();
			}
		};
	}
	return {call, subscribe};
}

/*
	Foundations' Activity, for an activity a call brings: adopt() (from
	activitymanager) or monitor() (from anyone else), then complete(restart).
	It owns the activity when the adopt said adopted, or an "orphan" event
	came; only then does complete() complete it, else it just lets go.
*/
function createActivity(palm, log) {
	let id, serial, owner = false, cancel = null;
	const activity = {name: undefined};
	const onEvent = (e, r) => {
		if (e || !r) {
			return;
		}
		if (r.event === 'orphan') {
			owner = true;
		} else if (r.event === 'adopted') {
			owner = false;
		} else if (r.event === 'stop' || r.event === 'cancel' || r.event === 'complete') {
			letGo();
		}
	};
	function letGo() {
		if (cancel) {
			cancel();
			cancel = null;
		}
	}
	// -> the first reply; throws as PalmCall does.
	function hold(method, args, first) {
		return new Promise((resolve, reject) => {
			let seen = false;
			cancel = palm.subscribe(AM, method, args, (e, r) => {
				if (seen) {
					onEvent(e, r);
					return;
				}
				seen = true;
				if (e) {
					cancel = null;
					reject(e);
					return;
				}
				first(r);
				resolve(r);
			});
		});
	}
	activity.adopt = (activityId, callbackSerial) => {
		activity.name = 'ActivityManager activity' + activityId;
		id = activityId;
		serial = callbackSerial;
		const args = {activityId: id, subscribe: true};
		if (serial) {
			args.serial = serial;
		}
		return hold('adopt', args, r => {
			if (r.adopted || r.event === 'orphan') {
				owner = true;
			}
		});
	};
	activity.monitor = activityId => {
		activity.name = 'Monitored activityID' + activityId;
		id = activityId;
		return hold('monitor', {activityId: id, subscribe: true}, () => {});
	};
	activity.complete = restart => {
		if (!owner) {
			if (restart) {
				log.error('Tried to complete&restart an activity we don\'t own - ' + id);
			}
			letGo();
			return Promise.resolve();
		}
		const options = {activityId: id};
		if (restart) {
			options.restart = true;
		}
		if (serial) {
			options.serial = serial;
		}
		return palm.call(AM, 'complete', options).then(letGo, e => {
			letGo();
			log.error('complete ' + id + ' failed: ' + e.message);
		});
	};
	return activity;
}

/*
	A bus method that answers as mojoservice did. run(params, sub) is the
	command; sub, for a subscribed call to a method with subscribe:true, sends
	it a further reply (sub(result)), else it is null. complete(activity,
	params), if given, lets go of the activity the call brought (by default
	activity.complete()); it runs after the reply.
*/
function command(service, name, run, {palm, timeoutS = DEFAULT_TIMEOUT_S, log = console, subscribe = false, complete} = {}) {
	return {
		raw: true,
		subscribe,
		// The command's own clock (below) answers a command that takes too long; the bus's never does.
		timeoutMs: 0x7fffffff,
		handler: async (params, ctx = {}) => {
			let activity = null, cleaned = false;
			const cleanup = () => {
				if (cleaned || !activity) {
					cleaned = true;
					return;
				}
				cleaned = true;
				const a = activity;
				setImmediate(() => {
					try {
						Promise.resolve(complete ? complete(a, params) : a.complete()).catch(e => {
							log.error(service + ': ' + name + ': complete failed: ' + ((e && e.message) || e));
						});
					} catch (e) {
						log.error(service + ': ' + name + ': complete() threw: ' + e.message);
						a.complete();
					}
				});
			};
			if (params.$activity) {
				const a = params.$activity;
				activity = createActivity(palm, log);
				if (fromActivityManager(ctx.sender)) {
					try {
						await activity.adopt(a.activityId, a.callback && a.callback.serial);
					} catch (e) {
						log.error('MojoService failed to adopt activity ' + a.activityId + ' : ' + e);
						cleanup();
						return reply({status: 'adopt failed', error: errString(e)});
					}
					if (ctx.replyNow) {
						ctx.replyNow({returnValue: true});
					}
				} else {
					try {
						await activity.monitor(a.activityId);
					} catch (e) {
						log.error('MojoService failed to monitor activity ' + a.activityId + ' : ' + e);
						cleanup();
						// mojoservice sent the error itself: its enumerable fields, and returnValue.
						const out = JSON.parse(JSON.stringify(e));
						out.returnValue = false;
						return out;
					}
				}
			}
			let timer = null, timedOut = null, expired = false;
			const late = new Promise(resolve => {
				timedOut = resolve;
			});
			const arm = () => {
				timer = setTimeout(() => {
					const text = 'commandTimeout in ' + service + '/' + name;
					log.error(text);
					expired = true;
					timedOut({timeout: err(504, text)});
				}, timeoutS * 1000);
			};
			const disarm = () => {
				if (timer) {
					clearTimeout(timer);
					timer = null;
				}
			};
			arm();
			const subscribed = subscribe && !!ctx.subscribed;
			const sub = subscribed ? (result => {
				if (expired) {
					return;
				}
				disarm();
				ctx.push(subscriptionReply(result));
			}) : null;
			if (subscribed && ctx.onCancel) {
				ctx.onCancel(cleanup);
			}
			const done = Promise.resolve().then(() => run(params, sub)).then(result => ({result}), e => ({e}));
			const out = await Promise.race([done, late]);
			disarm();
			let answer;
			if (out.timeout) {
				answer = exception(out.timeout);
			} else if (out.e) {
				log.error(service + ': ' + name + ' failed: ' + ((out.e && out.e.stack) || out.e));
				answer = exception(out.e);
			} else {
				answer = reply(out.result);
			}
			// A subscription stays open after a result, and lets go of the activity when cancelled.
			if (!subscribed || answer.returnValue === false) {
				cleanup();
			}
			return answer;
		}
	};
}

module.exports = {command, reply, subscriptionReply, exception, err, errString, createPalm, createActivity, join, fromActivityManager,
	DEFAULT_TIMEOUT_S};
