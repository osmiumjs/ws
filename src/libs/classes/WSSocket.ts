import {Events}      from '@osmium/events';
import {isArray}     from '@osmium/is';
import {iterateSync} from '@osmium/iterate';

import {ObjectKeyString, SocketMetadata, SocketMetadataKeys} from '../types';
import {WSMessage}                                           from './WSMessage';
import {WSSocketEvents}                                      from './WSSocketEvents';

import EDirection = WSMessage.EDirection;
import ESource = WSMessage.ESource;

export class WSSocket extends Events<string, SocketMetadata> {
	public ws: WSSocketEvents;
	public id: WSSocket.ID;
	public events: Events<string> = new Events<string>();

	protected serializer: WSMessage.Serializer;

	readonly options: WSSocket.IOptions;

	constructor(ws: WSSocketEvents, id: WSSocket.ID, options: Partial<WSSocket.IOptions>) {
		super();

		this.options = {
			isServer     : options.isServer || false,
			symbols      : Object.assign({
				TIMEOUT: Symbol('TIMEOUT')
			}, (options.symbols || {})),
			returnTimeout: options.returnTimeout || 30000,
			getPacketID  : options.getPacketID || (() => Events.UID('WSM-'))
		};

		this.serializer = WSMessage.Serializer.createInstance();
		this.ws = ws;
		this.id = id;

		this.setMiddlewares();
		this.setHandlers();
	}

	private setMiddlewares() {
		function _makeResult(some: Events.EmitResult<unknown>): unknown[] {
			return iterateSync(some, (row) => row, []);
		}

		const {isServer} = this.options;

		this.useBefore(async (ctx) => {
			//Fill meta if simple emit-like
			const callMeta: WSSocket.ICallMetadata = ctx.getMetadata(SocketMetadataKeys.Call) || {
				id       : this.options.getPacketID(),
				source   : isServer ? ESource.SERVER : ESource.CLIENT,
				direction: EDirection.CALL
			} as WSSocket.ICallMetadata;

			ctx.setMetadata(SocketMetadataKeys.Call, callMeta);
			ctx.setMetadata(SocketMetadataKeys.Message, {});
		}, -10);

		this.useBefore(async (ctx) => {
			const callMetadata = ctx.getMetadata(SocketMetadataKeys.Call);
			const messageMetadata = ctx.getMetadata(SocketMetadataKeys.Message);
			const name = ctx.getEventName();
			const args = ctx.getArguments();

			if (!callMetadata) return;
			if (callMetadata.source === ESource.LOCAL) return;

			if ((callMetadata.direction === EDirection.CALL && ((callMetadata.source === ESource.CLIENT && !isServer))
			     || (callMetadata.source === ESource.SERVER && isServer))
			) {
				ctx.reject(await this.sendOutcomingEmit(callMetadata.id, name, args, messageMetadata || {}, callMetadata.source));

				return;
			}
		}, 1000);

		this.useAfter(async (ctx) => {
			const callMetadata = ctx.getMetadata(SocketMetadataKeys.Call);
			const messageMetadata = ctx.getMetadata(SocketMetadataKeys.Message);
			const name = ctx.getEventName();
			const args = ctx.getReturn();

			if (!callMetadata) return;

			if (callMetadata.source === ESource.LOCAL) {
				ctx.reject<any[]>(_makeResult(args));
			}

			if ((callMetadata.direction === EDirection.CALL && ((callMetadata.source === ESource.CLIENT && isServer))
			     || (callMetadata.source === ESource.SERVER && !isServer))
			) {
				await this.sendIncomingResult(callMetadata.id, name, _makeResult(args), messageMetadata || {});
			}
		}, 1000);
	}

	private setHandlers() {
		this.ws.events.on<WSSocketEvents.MESSAGE>(WSSocketEvents.event.MESSAGE, async (event) => {
			const {
				      id,
				      name,
				      args,
				      metadata,
				      source,
				      direction
			      } = this.serializer.deserializeMessage(event.data as Buffer);

			const eventName = direction === EDirection.CALL
			                  ? `${name}`
			                  : `${name} ${id}`;

			await this.emitEx(eventName, {
				metadata: {
					[SocketMetadataKeys.Message]: metadata,
					[SocketMetadataKeys.Call]   : {
						id,
						direction,
						source
					} as WSSocket.ICallMetadata
				}
			}, ...(isArray(args) ? args : []));
		});

		this.ws.events.on<WSSocketEvents.CLOSE>(WSSocketEvents.event.CLOSE, async () => {
			this.disconnect();

			await this.events.emit<WSSocket.DISCONNECTED>(WSSocket.event.DISCONNECTED, this.id);
		});

		this.ws.events.on<WSSocketEvents.ERROR>(WSSocketEvents.event.ERROR, async () => {
			this.disconnect();

			await this.events.emit<WSSocket.DISCONNECTED>(WSSocket.event.DISCONNECTED, this.id);
		});
	}

	private async sendIncomingResult<MetadataType extends ObjectKeyString = {}>(id: string, name: string, args: unknown[], metadata: MetadataType) {
		const rawPacket: ArrayBuffer = this.serializer.serializeMessage({
			id,
			name,
			args,
			metadata,
			source   : this.options.isServer ? ESource.SERVER : ESource.CLIENT,
			direction: EDirection.RETURN
		});

		try {
			await this.ws.send(rawPacket);
		} catch (e) {
			await this.events.emit<WSSocket.DISCONNECTED>(WSSocket.event.DISCONNECTED, this.id);
		}
	}

	private async sendOutcomingEmit<MetadataType extends ObjectKeyString = {}>(id: string, name: string, args: unknown[], metadata: MetadataType, source: WSMessage.ESource) {
		let disconnectOnID: Events.EventId | null = null;

		const promise = new Promise(async (resolve) => {
			const rawPacket: ArrayBuffer = this.serializer.serializeMessage({
				id,
				name,
				args,
				metadata,
				source,
				direction: EDirection.CALL
			});

			const retEventId = this.once(`${name} ${id}`, (ret) => {
				clearTimeout(timeoutId);

				resolve(ret);
			});

			disconnectOnID = this.events.once(WSSocket.event.DISCONNECTED, () => {
				this.offById(retEventId);

				resolve(this.options.symbols.TIMEOUT);
			});

			const timeoutId = setTimeout(() => {
				this.offById(retEventId);

				resolve(this.options.symbols.TIMEOUT);
			}, this.options.returnTimeout);

			try {
				await this.ws.send(rawPacket);
			} catch (e) {
				this.events.emit<WSSocket.DISCONNECTED>(WSSocket.event.DISCONNECTED, this.id).then();
			}
		});

		if (disconnectOnID !== null) {
			this.events.offById(disconnectOnID);
		}

		return promise;
	}

	async emitMeta<MetdataType extends object = {}, ArgsType extends unknown[] = unknown[], ReturnType = unknown>(name: Events.EventName, meta: MetdataType, ...args: ArgsType): Promise<Events.EmitResult<ReturnType>> {
		return this.emitEx<ArgsType, ReturnType>(name, {
			metadata: {
				[SocketMetadataKeys.Message]: meta,
			}
		}, ...args);
	}

	async emitMetaLocal<MetdataType extends object = {}, ArgsType extends unknown[] = unknown[], ReturnType = unknown>(name: Events.EventName, meta: MetdataType, ...args: ArgsType): Promise<Events.EmitResult<ReturnType>> {
		return this.emitEx<ArgsType, ReturnType>(name, {
			metadata: {
				[SocketMetadataKeys.Message]: meta,
				[SocketMetadataKeys.Call]   : {
					id       : this.options.getPacketID(),
					source   : WSMessage.ESource.LOCAL,
					direction: WSMessage.EDirection.CALL
				} as WSSocket.ICallMetadata
			}
		}, ...args);
	}

	async emitLocal<ArgsType extends unknown[] = unknown[], ReturnType = unknown>(name: Events.EventName, ...args: ArgsType): Promise<Events.EmitResult<ReturnType>> {
		return this.emitEx<ArgsType, ReturnType>(name, {
			metadata: {
				[SocketMetadataKeys.Call]: {
					id       : this.options.getPacketID(),
					source   : WSMessage.ESource.LOCAL,
					direction: WSMessage.EDirection.CALL
				} as WSSocket.ICallMetadata
			}
		}, ...args);
	}

	disconnect() {
		try {
			this.ws.close();
		} catch (e) {}
	}
}

export namespace WSSocket {
	export type ID = string;

	export enum event {
		CONNECTED    = 'connected',
		MESSAGE      = 'message',
		DISCONNECTED = 'disconnected',
		ERROR        = 'error'
	}

	export type CONNECTED = [WSSocket];
	export type MESSAGE = [ArrayBuffer]
	export type DISCONNECTED = [ID];

	export interface ICallMetadata {
		id: string;
		source: WSMessage.ESource;
		direction: WSMessage.EDirection;
		timeout?: number | null;
	}

	export interface IOptions {
		returnTimeout: number;
		getPacketID: Function;
		symbols: ISymbols;
		isServer: boolean;
	}

	export interface ISymbols {
		TIMEOUT: Symbol;
	}
}