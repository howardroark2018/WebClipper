import {SmartValue} from "../communicator/smartValue";

import {Constants} from "../constants";
import {Utils} from "../utils";

import * as Log from "./log";
import {Context} from "./context";
import {Logger} from "./logger";

export interface SessionLoggerOptions {
	contextStrategy?: Context;
	sessionId?: SmartValue<string>;
}

export abstract class SessionLogger extends Logger {
	// Variables used to control gating calls
	protected contextStrategy: Context;
	protected isQueueFlushed: boolean;
	protected isQueueFlushing: boolean;

	// State
	protected contextProperties: { [key: string]: string | number | boolean } = {};
	protected currentSessionState: Log.Session.State = Log.Session.State.Ended;
	protected logQueue: Log.LogDataPackage[] = [];
	protected streams: { [key: string]: any[] } = {};
	protected userHasInteracted: boolean = false;
	protected sessionId: SmartValue<string> = undefined;

	constructor(options?: SessionLoggerOptions) {
		super();

		this.sessionId = options && options.sessionId ? options.sessionId : new SmartValue<string>();
		this.contextStrategy = options ? options.contextStrategy : undefined;
	}

	protected abstract handleClickEvent(clickId: string): void;
	protected abstract handleEvent(event: Log.Event.BaseEvent): void;
	protected abstract handleEventPure(event: Log.Event.BaseEvent): void;
	protected abstract handleFailure(label: Log.Failure.Label, failureType: Log.Failure.Type, failureInfo?: OneNoteApi.GenericError, id?: string): void;
	protected abstract handleUserFunnel(label: Log.Funnel.Label): void;
	protected abstract handleSessionStart(): void;
	protected abstract handleSessionEnd(endTrigger: Log.Session.EndTrigger): void;
	protected abstract handleTrace(label: Log.Trace.Label, level: Log.Trace.Level, message?: string): void;
	protected abstract handleSetUserSessionId(sessionId?: string): string;
	protected abstract handleSetContext(key: Log.Context.Custom, value: string | number | boolean): void;

	public hasUserInteracted(): boolean {
		return this.userHasInteracted;
	}

	public getUserSessionId(sessionId?: string): string {
		return this.sessionId.get();
	}

	public sendFunnelInteractionEvent(clickId: string): void {
		// These events do not count as "interactions" as they are tied to some other user intention
		let nonInteractionEvents = [Constants.Ids.signInButtonMsa, Constants.Ids.signInButtonOrgId,
			Constants.Ids.signOutButton, Constants.Ids.closeButton, Constants.Ids.clipButton, Constants.Ids.launchOneNoteButton,
			Constants.Ids.checkOutWhatsNewButton, Constants.Ids.proceedToWebClipperButton];

		if (this.hasUserInteracted() || nonInteractionEvents.indexOf(clickId) !== -1) {
			return;
		}
		this.userHasInteracted = true;
		this.logUserFunnel(Log.Funnel.Label.Interact);
	}

	public logEvent(event: Log.Event.BaseEvent): void {
		if (Utils.isNullOrUndefined(event)) {
			this.logFailure(Log.Failure.Label.InvalidArgument, Log.Failure.Type.Unexpected);
			return;
		}

		if (!this.areContextRequirementsMet()) {
			this.pushDataPackage(Log.LogMethods.logEvent, arguments);
			return;
		}

		this.handleEvent(event);
	}

	public logFailure(label: Log.Failure.Label, failureType: Log.Failure.Type, failureInfo?: OneNoteApi.GenericError, id?: string): void {
		if (Utils.isNullOrUndefined(label) || Utils.isNullOrUndefined(failureType)) {
			this.logFailure(Log.Failure.Label.InvalidArgument, Log.Failure.Type.Unexpected);
			return;
		}

		if (!this.areContextRequirementsMet()) {
			this.pushDataPackage(Log.LogMethods.logFailure, arguments);
			return;
		}

		this.handleFailure(label, failureType, failureInfo, id);
	}

	public logUserFunnel(label: Log.Funnel.Label): void {
		if (Utils.isNullOrUndefined(label)) {
			this.logFailure(Log.Failure.Label.InvalidArgument, Log.Failure.Type.Unexpected);
			return;
		}

		if (!this.areContextRequirementsMet()) {
			this.pushDataPackage(Log.LogMethods.logFunnel, arguments);
			return;
		}

		this.handleUserFunnel(label);
	}

	public logSessionStart(): void {
		if (!this.areContextRequirementsMet()) {
			this.pushDataPackage(Log.LogMethods.logSessionStart, arguments);
			return;
		}

		this.executeSessionStart();
		this.handleSetUserSessionId();
	}

	protected executeSessionStart(): void {
		if (this.currentSessionState === Log.Session.State.Started) {
			let errorMessage = "Session already STARTED";
			this.logFailure(Log.Failure.Label.SessionAlreadySet, Log.Failure.Type.Unexpected, { error: errorMessage });
			return;
		}

		this.streams = {};
		this.currentSessionState = Log.Session.State.Started;

		this.handleSessionStart();
	}

	public logSessionEnd(endTrigger: Log.Session.EndTrigger): void {
		if (!this.areContextRequirementsMet()) {
			this.pushDataPackage(Log.LogMethods.logSessionEnd, arguments);
			return;
		}

		this.executeSessionEnd(endTrigger);
		this.handleSetUserSessionId();
	}

	protected executeSessionEnd(endTrigger: Log.Session.EndTrigger): void {
		if (this.currentSessionState === Log.Session.State.Ended) {
			let errorMessage = "Session already ENDED";
			if (!Utils.isNullOrUndefined(endTrigger)) {
				errorMessage += ". EndTrigger: " + Log.Session.EndTrigger[endTrigger];
			}
			this.logFailure(Log.Failure.Label.SessionAlreadySet, Log.Failure.Type.Unexpected, { error: errorMessage });
			return;
		}

		this.logAllStreams();
		this.sessionId.set(undefined);
		this.userHasInteracted = false;
		this.currentSessionState = Log.Session.State.Ended;

		this.handleSessionEnd(endTrigger);
	}

	public logTrace(label: Log.Trace.Label, level: Log.Trace.Level, message?: string): void {
		if (Utils.isNullOrUndefined(label) || Utils.isNullOrUndefined(level)) {
			this.logFailure(Log.Failure.Label.InvalidArgument, Log.Failure.Type.Unexpected);
			return;
		}

		if (!this.areContextRequirementsMet()) {
			this.pushDataPackage(Log.LogMethods.logTrace, arguments);
			return;
		}

		this.handleTrace(label, level, message);
	}

	public pushToStream(label: Log.Event.Label, value: any) {
		if (Utils.isNullOrUndefined(label)) {
			this.logFailure(Log.Failure.Label.InvalidArgument, Log.Failure.Type.Unexpected);
			return;
		}

		let labelAsString = Log.Event.Label[label];
		if (value) {
			if (!this.streams[labelAsString]) {
				this.streams[labelAsString] = [];
			}
			this.streams[labelAsString].push(value);
		}
	}

	public logClickEvent(clickId: string): void {
		if (!this.areContextRequirementsMet()) {
			this.pushDataPackage(Log.LogMethods.logClickEvent, arguments);
			return;
		}

		this.sendFunnelInteractionEvent(clickId);
		this.executeClickEvent(clickId);
	}

	protected executeClickEvent(clickId: string) {
		if (!clickId) {
			this.logFailure(Log.Failure.Label.InvalidArgument, Log.Failure.Type.Unexpected,
				{ error: "Button clicked without an ID! Logged with ID " + JSON.stringify(clickId) });
			return;
		}
		this.pushToStream(Log.Event.Label.Click, clickId);
		this.handleClickEvent(clickId);
	}

	public setContextProperty(key: Log.Context.Custom, value: string | number | boolean): void {
		this.setContextPropertyPure(key, value);

		this.handleSetContext(key, value);

		if (this.areContextRequirementsMet()) {
			this.flushEventQueue();
		}
	}

	protected setContextPropertyPure(key: Log.Context.Custom, value: string | number | boolean): void {
		let keyAsString = Log.Context.toString(key);
		this.contextProperties[keyAsString] = value;
	}

	private areContextRequirementsMet(): boolean {
		if (this.contextStrategy) {
			return this.contextStrategy.requirementsAreMet(this.contextProperties);
		} else {
			return true;
		}
	}

	private flushEventQueue(): void {
		if (this.isQueueFlushing || this.isQueueFlushed) {
			return;
		}
		this.isQueueFlushing = true;

		this.logQueue.forEach((data: Log.LogDataPackage) => {
			switch (data.methodName) {
				case Log.LogMethods.logEvent:
					this.logEvent.apply(this, data.methodArgs);
					break;
				case Log.LogMethods.logFailure:
					this.logFailure.apply(this, data.methodArgs);
					break;
				case Log.LogMethods.pushToStream:
					this.pushToStream.apply(this, data.methodArgs);
					break;
				case Log.LogMethods.logFunnel:
					this.logUserFunnel.apply(this, data.methodArgs);
					break;
				case Log.LogMethods.logSessionStart:
					this.logSessionStart.apply(this, data.methodArgs);
					break;
				case Log.LogMethods.logSessionEnd:
					this.logSessionEnd.apply(this, data.methodArgs);
					break;
				case Log.LogMethods.logClickEvent:
					this.logClickEvent.apply(this, data.methodArgs);
					break;
				case Log.LogMethods.setContextProperty:
					this.setContextProperty.apply(this, data.methodArgs);
					break;
				case Log.LogMethods.logTrace:
				/* falls through */
				default:
					this.logTrace.apply(this, data.methodArgs);
					break;
			}
		});

		this.isQueueFlushing = false;
		this.isQueueFlushed = true;
	}

	private logAllStreams(): void {
		for (let property in this.streams) {
			if (this.streams.hasOwnProperty(property)) {
				let streamEvent = new Log.Event.StreamEvent(Log.Event.Label[property]);
				let stream = this.streams[property];
				for (let i = 0; i < stream.length; i++) {
					streamEvent.append(stream[i]);
				}
				this.handleEventPure(streamEvent);
			}
		}
	}

	private pushDataPackage(methodName: Log.LogMethods, methodArgs: IArguments | Array<any>) {
		this.logQueue.push({ methodName: methodName, methodArgs: methodArgs });
	}
}
