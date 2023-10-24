import {isString} from '@osmium/is';

export interface WSErrorDescriptor {
	code: number,
	message: string
}

export enum WSErrors {
	IS_CONNECTED_READONLY,
	IS_CONNECTING_READONLY,
	INCOMING_MESSAGE_FAIL_DESERIALISE,
	INCOMING_MESSAGE_WRONG_VERSION,
	INCOMING_MESSAGE_UNKNOWN_DIRECTION,
	NOT_CONNECTED,
	CONNECTION_TIMEOUT
}

export class WSError<MetadataType = any> extends Error {
	readonly text: string;
	readonly metadata: MetadataType;
	readonly code: number;

	static list: Record<WSErrors, WSErrorDescriptor> = {
		[WSErrors.IS_CONNECTED_READONLY]             : {
			code   : 101,
			message: 'isConnected is read-only field'
		},
		[WSErrors.IS_CONNECTING_READONLY]            : {
			code   : 102,
			message: 'isConnecteding is read-only field'
		},
		[WSErrors.INCOMING_MESSAGE_FAIL_DESERIALISE] : {
			code   : 201,
			message: 'Deserialization of incoming message failed'
		},
		[WSErrors.INCOMING_MESSAGE_WRONG_VERSION]    : {
			code   : 202,
			message: 'Incoming packet has wrong packet version'
		},
		[WSErrors.INCOMING_MESSAGE_UNKNOWN_DIRECTION]: {
			code   : 203,
			message: 'Incoming packet has unknown direcion'
		},
		[WSErrors.NOT_CONNECTED]                     : {
			code   : 500,
			message: 'Socket is not connected'
		},
		[WSErrors.CONNECTION_TIMEOUT]                : {
			code   : 999,
			message: 'Connection timeout'
		}
	};

	override toString() {
		return this.text;
	}

	override valueOf() {
		return this.text;
	}

	getMetadata(): MetadataType {
		return this.metadata;
	}

	constructor(errorIdx: WSErrors, metadata?: any, context?: any) {
		let error = WSError.list[errorIdx];
		if (!error) {
			error = {
				message: 'Unknown error',
				code   : -1
			};
		}

		super(error.message);

		this.metadata = metadata instanceof Error ? metadata.message : metadata;
		this.code = error.code;

		let className = 'unknown';
		let methodName = 'unknown';

		if (this.stack) {
			[className, methodName] = this.stack.split('at ')[1].split(' ')[0].split('.');
		}
		if (className === 'Function') {
			className = context?.name ? `${context.name}::` : `${className}.`;
		}

		this.text = `Osmium WS - Error #${error.code} (${className}${methodName}): ${error.message}` + (isString(this.metadata) ? ` > ${this.metadata}` : '');
	}
}