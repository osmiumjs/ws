import {isArray}                                   from '@osmium/is';
import * as Buffer                                 from 'buffer';
import {IncomingMessage, Server as HTTPServer}     from 'http';
import {Server as HTTPSServer}                     from 'https';
import WebSocket, {ServerOptions, WebSocketServer} from 'ws';

import {Events, EventsEmit}            from '@osmium/events';
import {iterate, iterateParallelLimit} from '@osmium/iterate';

import {WSMessage, WSSocket, WSSocketEvents}                 from '../libs';
import {ObjectKeyString, SocketMetadata, SocketMetadataKeys} from '../libs/types';

import ESource = WSMessage.ESource;
import ICallMetadata = WSSocket.ICallMetadata;
import EDirection = WSMessage.EDirection;

export class WSServer extends Events<string, SocketMetadata> {
	//#region Fields
	protected serializer: WSMessage.Serializer;
	protected server: WebSocketServer;
	clients: WSServer.Clients = new Map();
	protected symbols: WSSocket.ISymbols = {
		TIMEOUT: Symbol('TIMEOUT')
	};

	isReady: boolean = false;
	events: Events<string> = new Events<string>();

	//#endregion

	/** @description Create WSServer instance */
	static async createInstance(params: WSServer.Params): Promise<WSServer> {
		const instance = new WSServer(params);
		await instance.awaitReady();

		return instance;
	}

	/** @description [!] Please use WSServer.createInstance instead */
	constructor(params: WSServer.Params) {
		super();

		let options: ServerOptions = {};
		switch (params.serverMode) {
			case WSServer.ServerMode.Standalone:
				options = {
					port: params.port || 80,
					host: params.host || '0.0.0.0'
				};
				break;

			case WSServer.ServerMode.HTTP:
				options = {
					server: params.server,
					path  : params.path || '/'
				};
				break;

			default:
				throw new Error('Unknown server mode');
		}

		this.serializer = WSMessage.Serializer.createInstance();
		this.server = new WebSocketServer(options);

		this.registerHandlers();
	}

	private registerHandlers() {
		this.onWSEventListening(() => {
			this.isReady = true;
		});

		this.onWSEventConnection(async (wsNativeSocket, {headers}) => {
			await (new Promise(r => setTimeout(r, 100)));
			const ws = WSSocketEvents.createInstance(wsNativeSocket, false);

			//Create our socket
			const id = Events.UID(WSServer.WS.ClientIDPrefix);
			const client = new WSSocket(ws, id, {
				isServer: true,
				symbols : this.symbols,
			});
			ws.socket.onopen?.({type: 'onopen', target: wsNativeSocket as WebSocket});

			let jwtToken: string | null = null;

			//Await handshake
			try {
				jwtToken = await this.handleHandShake(id, ws);
				if (!jwtToken) return;
			} catch (e) {
				return;
			}

			//Processs normal connection
			this.clients.set(client.id, {client, jwtToken: jwtToken as string});

			client.mapEventsAfter(this);

			client.events.on<WSSocket.DISCONNECTED>(WSSocket.event.DISCONNECTED, (id) => {
				const ctx = this.clients.get(id);
				if (ctx?.client?.ws) ctx?.client.ws?.close();

				this.clients.delete(id);

				this.events.emit<WSServer.Event.DISCONNECTED>(WSServer.event.DISCONNECTED, id);
			});

			await this.events.emit(WSServer.event.CONNECTED, client.id, client);
		});


		this.useBefore(async (ctx) => {
			const emitData = ctx.getMetadata(SocketMetadataKeys.Server) || {} as WSServer.EmitMetadata;
			const mtd = ctx.getMetadata(SocketMetadataKeys.Call) || {} as ICallMetadata;

			if (Object.keys(mtd).length || emitData.local) return;

			ctx.reject(await this.prcessClients(this.clients, ctx.getEventName(), ctx.getArguments(), emitData));
		});
	}

	private async handleHandShake(id: WSSocket.ID, ws: WSSocketEvents): Promise<string | null> {
		const _close = () => {
			ws.close();

			this.clientDisconnect(id);
			return null;
		};

		//Await id request
		const requestRaw = await ws.events.wait<WSSocketEvents.MESSAGE>(WSSocketEvents.event.MESSAGE, 6500);
		if (!requestRaw?.[0]?.data) return _close();

		const request = this.serializer.deserializeHSClientServerRequest(requestRaw?.[0]?.data as Buffer);
		if (request === null) return _close();

		//Send id
		ws.socket.send(this.serializer.serializeHSServerClientResponse({
			id,
			success: true,
			payload: {}
		}));

		//Await ready signal
		const responseRaw = await ws.events.wait<WSSocketEvents.MESSAGE>(WSSocketEvents.event.MESSAGE, 6500);
		if (!responseRaw?.[0]?.data) return _close();

		const response = this.serializer.deserializeHSServerClientResponse<{ jwtToken: string }>(responseRaw?.[0]?.data as Buffer);
		if (!response?.success) return _close();


		//Send confirmation
		ws.socket.send(this.serializer.serializeHSServerClientResponse({
			id,
			success: true,
			payload: {}
		}));

		//Normal connection
		return response.payload.jwtToken;
	}

	async waitMessage<ReturnType extends ObjectKeyString = {}>(wsSocket: WebSocket, cb: (data: Buffer) => Promise<ReturnType> | ReturnType, timeout: number = 10000): Promise<ReturnType | null> {
		return new Promise((resolve) => {
			let tId = setTimeout(() => {
				resolve(null);
			}, timeout);

			wsSocket.once('message', (data, isBinary) => {
				if (!isBinary) return;

				const out = cb(data as Buffer);
				clearTimeout(tId);
				resolve(out);
			});
		});
	}

	onConnect(cb: (...args: WSServer.Event.CONNECTED) => Promise<void> | void) {
		this.events.on(WSServer.event.CONNECTED, cb);
	}

	onDisconnect(cb: (...args: WSServer.Event.DISCONNECTED) => Promise<void> | void) {
		this.events.on(WSServer.event.DISCONNECTED, cb);
	}

	//#region WSServer Event listiners
	onWSEventListening(cb: () => void | Promise<void>): void {
		this.server.on(WSServer.WS.ServerEvents.LISTENING, () => cb());
	}

	onWSEventHeaders(cb: (headers: string[], request: IncomingMessage) => void | Promise<void>): void {
		this.server.on(WSServer.WS.ServerEvents.HEADERS, cb);
	}

	onWSEventConnection(cb: (socket: WebSocket, request: IncomingMessage) => void | Promise<void>): void {
		this.server.on(WSServer.WS.ServerEvents.CONNECTION, cb);
	}

	onWSEventError(cb: (error: Error) => void | Promise<void>): void {
		this.server.on(WSServer.WS.ServerEvents.ERROR, cb);
	}

	onWSEventClose(cb: () => void | Promise<void>): void {
		this.server.on(WSServer.WS.ServerEvents.CLOSE, cb);
	}

	//#endregion

	/** @description Await WSServer ready for connections */
	async awaitReady(): Promise<void> {
		return new Promise((resolve) => {
			if (this.isReady) return resolve();

			this.onWSEventListening(resolve);
		});
	}

	private async prcessClients(clients: WSServer.Clients, name: string, args: unknown[], emitData: WSServer.EmitMetadata) {
		let res: { [key: string]: unknown } = {};

		let toList: WSServer.Clients = new Map();
		if (emitData.to) {
			iterate(emitData.to, (id, row) => {
				if (!clients.has(id)) return;

				toList.set(id, {
					client  : clients.get(id)?.client as WSSocket,
					jwtToken: clients.get(id)?.jwtToken as string
				});
			});
		}

		await iterateParallelLimit(100, emitData.to ? toList : clients, async ({client}, id) => {

			res[id] = await client.emitEx(name, {
				metadata: {
					[SocketMetadataKeys.Call]: {
						id       : client.options.getPacketID(),
						source   : ESource.SERVER,
						direction: EDirection.CALL,
						timeout  : emitData.timeout || null
					} as WSSocket.ICallMetadata
				},
			}, ...args);
		});

		const resKeys = Object.keys(res);
		if (resKeys.length) {
			return emitData.firstResult ? res[resKeys[0]] : res;
		} else {
			return emitData.firstResult ? undefined : {};
		}
	}

	clientDisconnect(id: string) {
		this.clients.get(id)?.client?.disconnect();
		this.clients.delete(id);
	}

	clientsDisconnect() {
		iterate(this.clients, (client, id) => {
			this.clientDisconnect(id);
		});
	}

	//#region WSServerEmits
	setMetadata(key: string, value: unknown): WSServer.Emits {
		return WSServer.Emits.createInstance(undefined, this).setMetadata(key, value);
	}

	local(): WSServer.Emits {
		return WSServer.Emits.createInstance(undefined, this).local();
	}

	to(destinations: string[] | string): WSServer.Emits {
		return WSServer.Emits.createInstance(undefined, this).to(destinations);
	}

	timeout(value: number): WSServer.Emits {
		return WSServer.Emits.createInstance(undefined, this).timeout(value);
	}

	firstResult(): WSServer.Emits {
		return WSServer.Emits.createInstance(undefined, this).firstResult();
	}

	//#endregion
}

export namespace WSServer {
	export namespace WS {
		export enum ServerEvents {
			LISTENING  = 'listening',
			HEADERS    = 'headers',
			CONNECTION = 'connection',
			ERROR      = 'error',
			CLOSE      = 'close',
		}

		export const ClientIDPrefix: string = 'WS-';
	}

	export enum event {
		CONNECTED    = 'connected',
		DISCONNECTED = 'disconnected'
	}

	export namespace Event {
		export type CONNECTED = [WSSocket.ID, WSSocket];
		export type DISCONNECTED = [WSSocket.ID | null];
	}

	export type Metadata = {
		wsServer: EmitMetadata,
		[key: string]: any;
	}

	export interface EmitMetadata {
		to: string[] | null;
		local: boolean;
		timeout: number | null;
		firstResult: boolean;

		[key: string]: any;
	}

	export type ClientsRow = {
		client: WSSocket,
		jwtToken: string
	}

	export type Clients = Map<WSSocket.ID, ClientsRow>;

	export enum ServerMode {
		Standalone,
		HTTP
	}

	export type ParamsHTTPServer = {
		serverMode: ServerMode.HTTP;
		server: HTTPServer | HTTPSServer;
		path?: string;
	}

	export type ParamsStandaloneServer = {
		serverMode: ServerMode.Standalone;
		port?: number;
		host?: string;
	}

	export type Params = ParamsHTTPServer | ParamsStandaloneServer;

	export class Emits extends EventsEmit<string, SocketMetadata> {
		metadata: EmitMetadata;

		static createInstance(config: Partial<Events.Config<SocketMetadata>> = {}, mapEmitOnce: Events<string, SocketMetadata> | null = null, metadata: ObjectKeyString = {}): Emits {
			return new Emits(config, mapEmitOnce, metadata);
		}

		constructor(config: Partial<Events.Config<SocketMetadata>> = {}, mapEmitOnce: Events<string, SocketMetadata> | null = null, metadata: SocketMetadata = {}) {
			config.metadata = metadata;
			super(config, mapEmitOnce);

			this.metadata = metadata[SocketMetadataKeys.Server] = {
				to         : null,
				local      : false,
				timeout    : null,
				firstResult: false
			};
		}

		setMetadata(key: string, value: unknown): Emits {
			this.metadata[key] = value;

			return this;
		}

		local(): Emits {
			this.metadata.local = true;

			return this;
		}

		to(destinations: WSSocket.ID[] | WSSocket.ID): Emits {
			this.metadata.to = isArray(destinations) ? destinations as WSSocket.ID[] : [destinations as WSSocket.ID];

			return this;
		}

		timeout(value: number): Emits {
			this.metadata.timeout = value;

			return this;
		}

		firstResult(): Emits {
			this.metadata.firstResult = true;

			return this;
		}
	}
}
