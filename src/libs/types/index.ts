import {WSServer} from '../../server';
import {WSSocket} from '../classes/WSSocket';

export type ObjectKeyString = { [key: string]: any };

export enum SocketMetadataKeys {
	Call    = 'Call',
	Message = 'Message',
	Server  = 'Server'
}

export type SocketMetadata = {
	[SocketMetadataKeys.Call]?: WSSocket.ICallMetadata;
	[SocketMetadataKeys.Message]?: ObjectKeyString;
	[SocketMetadataKeys.Server]?: WSServer.EmitMetadata;
}