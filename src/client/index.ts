import {Events}                              from '@osmium/events';
import {WSMessage, WSSocket, WSSocketEvents} from '../libs';

import WebSocket from 'isomorphic-ws';

export class WSClient extends Events<string> {
	protected readonly version: number = 1;
	protected readonly host: string = '';

	protected readonly options: WSClient.Options = {
		secure       : false,
		autoReconnect: true,
		getPacketID  : () => Events.UID('WSP-'),
		getCallID    : () => Events.UID('WSC-'),
		debug        : () => {}
	};

	symbols: WSSocket.ISymbols = {
		TIMEOUT: Symbol('TIMEOUT')
	};

	public readonly events: Events<WSClient.Events>;
	socket: WSSocket | null = null;
	private ws: WSSocketEvents | null = null;
	private jwtToken: string;

	protected serializer: WSMessage.Serializer;
	protected state: WSClient.State = WSClient.State.DISCONNECTED;

	get isDisconnected() {
		return this.state === WSClient.State.DISCONNECTED;
	}

	get isConnecting() {
		return this.state === WSClient.State.CONNECTING;
	}

	get isConnected() {
		return this.state === WSClient.State.CONNECTED;
	}

	get id(): string | null {
		return this.socket?.id || null;
	}

	static async createInstance(url: string, jwtToken: string, options: Partial<WSClient.Options>): Promise<WSClient> {
		const instance = new WSClient(url, jwtToken, options);
		await instance.connect();

		return instance;
	}

	constructor(url: string, jwtToken: string, options: Partial<WSClient.Options>) {
		super();

		this.jwtToken = jwtToken;
		this.events = new Events<WSClient.Events>();

		this.useBefore(async (ctx) => {
			if (this.isConnected) return;

			const res = await this.events.wait(WSClient.Events.CONNECTED, 7500);
			if (res) return;

			if (!this.options.autoReconnect) {
				throw new Error('Timeout');
			}

			await this.connect();
		});

		this.host = url;
		this.options = Object.assign(this.options, options);

		this.serializer = WSMessage.Serializer.createInstance();
	}

	private debug(...args: any[]) {
		this.options.debug(...args);
	}

	async connect(): Promise<boolean> {
		return new Promise(async (resolve) => {
			const _close = async () => {
				resolve(false);

				this.tryDisconnect().then();
			};

			this.debug(`[WSClient.disconnect()]: Connecting`);

			if (this.socket !== null) return resolve(false);

			this.state = WSClient.State.CONNECTING;

			//Make connection
			const _WebSocket = WebSocket?.WebSocket ?? WebSocket;
			const connectionString = `${this.options.secure ? 'wss' : 'ws'}://${this.host}`;
			this.debug(`[WSClient.connect()]: Connecting to ${connectionString}`);

			const wsNativeSocket = new _WebSocket(connectionString);
			this.ws = WSSocketEvents.createInstance(wsNativeSocket, true);

			//Process handshake
			const id = await this.handShakeHandling(this.ws);
			if (!id) {
				this.debug(`[WSClient.connect()]: Handshake not successful`);

				return _close();
			}

			this.debug(`[WSClient.connect()]: Handshake successful`);

			//Create our socket
			this.socket = new WSSocket(this.ws, id, {
				isServer: false,
				symbols : this.symbols
			});

			//Set handlers
			this.socket.events.once(WSSocket.event.DISCONNECTED, async () => {
				this.debug(`[WSClient.connect() > Event DISCONNECTED]: Start disconnecting`);

				await this.tryDisconnect();
			});

			this.mapEventsBefore(this.socket);
			this.socket.mapEventsBefore(this);

			this.state = WSClient.State.CONNECTED;
			await this.events.emit(WSClient.Events.CONNECTED);

			this.debug(`[WSClient.connect()]: Connect successful`);

			resolve(true);
		});
	}

	async handShakeHandling(ws: WSSocketEvents): Promise<WSSocket.ID | null> {
		const _close = async () => {
			this.debug(`[WSClient.handShakeHandling()>_close()]: call tryDisconnect`);
			await this.tryDisconnect();

			return null;
		};

		this.debug(`[WSClient.handShakeHandling()]: Handshake start`);

		//Request socket id
		setTimeout(() => {
			this.debug(`[WSClient.handShakeHandling()]: Handshake request #1`);

			ws.send(this.serializer.serializeHSClientServerRequest({
				version: this.version,
				payload: {}
			})).then();
		}, 100);

		//Await socket id response
		const responseRaw = await ws.events.wait<WSSocketEvents.MESSAGE>(WSSocketEvents.event.MESSAGE);
		const responseRawBinary = responseRaw?.[0]?.data;
		if (!responseRawBinary) {
			this.debug(`[WSClient.handShakeHandling()]: Handshake response #1 - raw - fail`, responseRawBinary);

			return await _close();
		}

		const response = this.serializer.deserializeHSServerClientResponse(responseRawBinary as ArrayBuffer);
		if (!response?.success) {
			this.debug(`[WSClient.handShakeHandling()]: Handshake response #1 - deserialize - not success`, response);

			return await _close();
		}

		this.debug(`[WSClient.handShakeHandling()]: Handshake response #1 - ok`, response);

		//Send ready signal
		setTimeout(() => {
			this.debug(`[WSClient.handShakeHandling()]: Handshake request #2`);

			ws.send(this.serializer.serializeHSClientServerResponse<{ jwtToken: string }>({
				success: true,
				payload: {
					jwtToken: this.jwtToken
				}
			})).then();
		}, 20);

		//Await confirmation
		const responseSecRaw = await ws.events.wait<WSSocketEvents.MESSAGE>(WSSocketEvents.event.MESSAGE);
		const responseSecRawBinary = responseSecRaw?.[0]?.data;
		if (!responseSecRawBinary) {
			this.debug(`[WSClient.handShakeHandling()]: Handshake response #2 - raw - fail`, responseSecRawBinary);

			return await _close();
		}

		const responseSec = this.serializer.deserializeHSServerClientResponse(responseSecRawBinary as ArrayBuffer);
		if (!responseSec?.success) {
			this.debug(`[WSClient.handShakeHandling()]: Handshake response #2 - deserialize - not success`, responseSec);

			return await _close();
		}

		this.debug(`[WSClient.handShakeHandling()]: Handshake response #2 - ok`, responseSec);
		this.debug(`[WSClient.handShakeHandling()]: Handshake finished, id: ${response.id}`);

		return response.id;
	}

	private async tryDisconnect() {
		if (this.options.autoReconnect) {
			await this.reconnect();
		} else {
			await this.disconnect();
		}
	}

	async disconnect() {
		this.state = WSClient.State.DISCONNECTED;

		if (this.socket === null) return;
		this.debug(`[WSClient.disconnect()]: Disconnect`);

		this.unMapEventsBefore(this.socket);
		this.socket.unMapEventsBefore(this);
		this.ws?.close();
		await this.events.emit(WSClient.Events.DISCONNECTED);

		if (this.socket === null) return;

		this.socket = null;
		this.ws = null;
	}

	async reconnect(): Promise<boolean> {
		await this.disconnect();
		return this.connect();
	}
}

export namespace WSClient {
	export enum State {
		DISCONNECTED = 'disconnected',
		CONNECTING   = 'connecting',
		CONNECTED    = 'connected'
	}

	export interface Options {
		autoReconnect: boolean;
		awaitReconnect?: boolean;
		secure: boolean;
		getPacketID: Function;
		getCallID: Function;
		debug: Function;
	}

	export enum Events {
		CONNECTED    = 'connected',
		DISCONNECTED = 'disconnected'
	}

	export interface MetadataFlags {
		messageCall: boolean;
		messageReturn: boolean;
		messageLocal: boolean;
	}
}
