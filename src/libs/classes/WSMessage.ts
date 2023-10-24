import {Serializer as OsmiumSerializer} from '@osmium/coder';
import {iterateKeysSync}                from '@osmium/iterate';

import {ObjectKeyString} from '../types';

function Fillable(Original: any) {
	const Target: any = function (arg: object) {
		const instance = new Original(arg);

		Object.assign(instance, arg);

		return instance;
	};

	Target.prototype = Original.prototype;
	return Target;
}

export namespace WSMessage {
	export enum ESource {
		SERVER = 0,
		CLIENT = 1,
		LOCAL  = 2,
	}

	export enum EDirection {
		CALL   = 0,
		RETURN = 1
	}

	class SchemaBasic<ChildType> {
		constructor(values: Partial<ChildType> = {}) {
			Object.assign(this, values);
		}

		version?: number = 1;    //Packet version
	}

	//#region Schemes
	@Fillable
	export class PacketMessage<ArgumentsType extends any[] = any[], MetadataType extends ObjectKeyString = {}> extends SchemaBasic<PacketMessage> {
		source!: ESource;        //Packet source type
		direction!: EDirection;  //Packet direcion
		id!: string;             //Packet ID
		name!: string;           //Event name
		args!: ArgumentsType;    //[...arguments] if call, [result] if return
		metadata!: MetadataType; //Data fields for middlewares only
	}

	@Fillable
	export class PacketHSClientServerRequest<PayloadType extends ObjectKeyString = {}> extends SchemaBasic<PacketHSClientServerRequest> {
		payload!: PayloadType;   //Payload
	}

	@Fillable
	export class PacketHSServerClientResponse<PayloadType extends ObjectKeyString = {}> extends SchemaBasic<PacketHSServerClientResponse> {
		id!: string;             //Packet ID
		payload!: PayloadType;   //Payload
		success!: boolean;       //Success
	}

	@Fillable
	export class PacketHSClientServerResponse<PayloadType extends ObjectKeyString = {}> extends SchemaBasic<PacketHSClientServerResponse> {
		payload!: PayloadType;   //Payload
		success!: boolean;       //Success
	}

	//#endregion

	export class Serializer {
		//#region Properties
		serializer: OsmiumSerializer;
		schema = new Map<number, typeof SchemaBasic>([
			[1, PacketHSClientServerRequest],
			[2, PacketHSServerClientResponse],
			[3, PacketHSClientServerResponse],
			[10, PacketMessage]
		]);
		//#endregion

		//#region Constructors
		static createInstance() {
			return new Serializer();
		}

		constructor() {
			this.serializer = new OsmiumSerializer(undefined, {
				useCompress: null,
				useCRC32   : true
			});

			iterateKeysSync(this.schema, (id, Schema) =>
				this.serializer.registerSchema(id, Object.keys(new Schema()))
			);
		}

		//#endregion

		//#region Packets

		//#region Packet - Handshake - Client>Server Request
		serializeHSClientServerRequest<PayloadType extends ObjectKeyString = {}>(packet: PacketHSClientServerRequest<PayloadType>): Buffer {
			return this.serializer.serialize<any>(new PacketHSClientServerRequest<PayloadType>(packet));
		}

		deserializeHSClientServerRequest<PayloadType extends ObjectKeyString = {}>(serializedPacket: Buffer): PacketHSClientServerRequest<PayloadType> {
			return this.serializer.deserialize(serializedPacket);
		}

		//#endregion

		//#region Packet - Handshake - Server>Client - Response
		serializeHSServerClientResponse<PayloadType extends ObjectKeyString = {}>(packet: PacketHSServerClientResponse<PayloadType>): Buffer {
			return this.serializer.serialize<any>(new PacketHSServerClientResponse<PayloadType>(packet));
		}

		deserializeHSServerClientResponse<PayloadType extends ObjectKeyString = {}>(serializedPacket: ArrayBuffer): PacketHSServerClientResponse<PayloadType> {
			return this.serializer.deserialize(new Uint8Array(serializedPacket));
		}

		//#endregion

		//#region Packet - Handshake - Client>Server - Response
		serializeHSClientServerResponse<PayloadType extends ObjectKeyString = {}>(packet: PacketHSClientServerResponse<PayloadType>): Buffer {
			return this.serializer.serialize<any>(new PacketHSClientServerResponse(packet));
		}

		deserializeHSClientServerResponse<PayloadType extends ObjectKeyString = {}>(serializedPacket: Buffer): PacketHSClientServerResponse<PayloadType> {
			return this.serializer.deserialize(serializedPacket);
		}

		//#endregion

		//#region Packet - Message
		serializeMessage<ArgumentsType extends any[], MetadataType extends ObjectKeyString = {}>(packet: PacketMessage<ArgumentsType, MetadataType>): Buffer {
			return this.serializer.serialize<any>(new PacketMessage<ArgumentsType, MetadataType>(packet));
		}

		deserializeMessage<ArgumentsType extends any[], MetadataType extends ObjectKeyString = {}>(serializedPacket: Buffer): PacketMessage<ArgumentsType, MetadataType> {
			return this.serializer.deserialize(serializedPacket);
		}

		//#endregion
		//#endregion
	}
}
