import {Events, EventsEmit} from '@osmium/events';
import MiddlewareMetadataDefault = Events.MiddlewareMetadataDefault;

class WSEventsOn {
	to(id: string): EventsEmit<string> {
		return new EventsEmit<string>();
	}

	toUser(id: string): EventsEmit<string> {
		return new EventsEmit<string>();
	}

	toUserSession(id: string): EventsEmit<string> {
		return new EventsEmit<string>();
	}

	toUserConnection(id: string): EventsEmit<string> {
		return new EventsEmit<string>();
	}

	getUserSessions(id: string) {

	}

	getUserConnections(id: string) {
		return new EventsEmit<string>();
	}

	drop() {}
}

class WSEvents extends Events<string> {
	constructor() {
		super();

		this.useBefore(async (ctx) => {
			ctx.getEventName();
		});
	}

	override on<ArgsType extends any[] = any[], ReturnType = any, ThisExtType extends object = WSEventsOn>(name: Events.EventName, cb: Events.EventCallback<string, MiddlewareMetadataDefault, ArgsType, ReturnType, ThisExtType>): Events.EventId {
		return super.on(name, cb);
	}

	override once<ArgsType extends any[] = any[], ReturnType = any, ThisExtType extends object = WSEventsOn>(name: Events.EventName<string>, cb: Events.EventCallback<string, MiddlewareMetadataDefault, ArgsType, ReturnType, ThisExtType>): Events.EventId {
		return super.once(name, cb);
	}
}