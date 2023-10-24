import {Events}                                                 from '@osmium/events';
import {MessageEvent, Event, CloseEvent, ErrorEvent, WebSocket} from 'isomorphic-ws';
import * as Buffer                                              from 'buffer';

export class WSSocketEvents {
	events: Events<WSSocketEvents.event>;
	socket: WebSocket;
	isConnected: boolean = false;

	static createInstance(socket: WebSocket, asArrayBuffer: boolean = true): WSSocketEvents {
		return new WSSocketEvents(socket, asArrayBuffer);
	}

	constructor(socket: WebSocket, asArrayBuffer: boolean = false) {
		this.events = new Events<WSSocketEvents.event>({});

		this.socket = socket;
		this.socket.binaryType = asArrayBuffer ? 'arraybuffer' : 'nodebuffer';

		socket.onopen = async (event: Event) => {
			this.isConnected = true;
			await this.events.emit<WSSocketEvents.OPEN>(WSSocketEvents.event.OPEN, event);
		};

		socket.onmessage = async (event: MessageEvent) => {
			await this.events.emit<WSSocketEvents.MESSAGE>(WSSocketEvents.event.MESSAGE, event);
		};

		socket.onclose = async (event: CloseEvent) => {
			this.isConnected = false;
			await this.events.emit<WSSocketEvents.CLOSE>(WSSocketEvents.event.CLOSE, event);
		};

		socket.onerror = async (event: ErrorEvent) => {
			await this.events.emit<WSSocketEvents.ERROR>(WSSocketEvents.event.ERROR, event);
		};
	}

	async waitConnected(): Promise<boolean> {
		if (this.isConnected) return true;

		return !!await this.events.wait<WSSocketEvents.OPEN>(WSSocketEvents.event.OPEN, 10000);
	}

	async send(data: ArrayBuffer | Buffer): Promise<void> {
		await this.waitConnected();

		return new Promise((resolve) => {
			this.socket.send(data, () => resolve(undefined));
		});
	}

	close(code?: number | undefined, data?: string | Buffer | undefined): void {
		this.socket?.close(code, data);
	}
}

export namespace WSSocketEvents {
	export enum event {
		OPEN    = 'open',
		MESSAGE = 'message',
		CLOSE   = 'close',
		ERROR   = 'error'
	}

	export type OPEN = [Event];
	export type MESSAGE = [MessageEvent]
	export type CLOSE = [CloseEvent];
	export type ERROR = [ErrorEvent]
}