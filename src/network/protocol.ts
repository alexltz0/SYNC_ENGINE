import { MessageType } from '../core/types';

export enum PacketType {
  HANDSHAKE = 0x01,
  HANDSHAKE_ACK = 0x02,
  DATA = 0x03,
  HEARTBEAT = 0x04,
  HEARTBEAT_ACK = 0x05,
  DISCONNECT = 0x06,
  ERROR = 0x07,
  BATCH = 0x08,
}

export interface Packet {
  type: PacketType;
  id: number;
  timestamp: number;
  payload: Buffer;
}

export interface HandshakePayload {
  version: number;
  nodeId: string;
  authToken?: string;
  capabilities: string[];
  compression: boolean;
}

export class BinaryProtocol {
  private static readonly HEADER_SIZE = 13;
  private static readonly MAGIC = 0x53454E47;
  private static readonly VERSION = 1;
  private sequenceId: number = 0;

  encode(type: PacketType, payload: Buffer): Buffer {
    const packet = Buffer.alloc(BinaryProtocol.HEADER_SIZE + payload.length);
    let offset = 0;

    packet.writeUInt32BE(BinaryProtocol.MAGIC, offset); offset += 4;
    packet.writeUInt8(BinaryProtocol.VERSION, offset); offset += 1;
    packet.writeUInt8(type, offset); offset += 1;
    packet.writeUInt16BE(this.nextSequence(), offset); offset += 2;
    packet.writeUInt32BE(payload.length, offset); offset += 4;

    const checksum = this.computeChecksum(payload);
    packet.writeUInt8(checksum, offset); offset += 1;

    payload.copy(packet, offset);
    return packet;
  }

  decode(data: Buffer): Packet | null {
    if (data.length < BinaryProtocol.HEADER_SIZE) return null;

    let offset = 0;
    const magic = data.readUInt32BE(offset); offset += 4;
    if (magic !== BinaryProtocol.MAGIC) return null;

    const version = data.readUInt8(offset); offset += 1;
    if (version !== BinaryProtocol.VERSION) return null;

    const type = data.readUInt8(offset) as PacketType; offset += 1;
    const id = data.readUInt16BE(offset); offset += 2;
    const payloadLength = data.readUInt32BE(offset); offset += 4;
    const checksum = data.readUInt8(offset); offset += 1;

    if (data.length < BinaryProtocol.HEADER_SIZE + payloadLength) return null;

    const payload = data.subarray(offset, offset + payloadLength);
    const computedChecksum = this.computeChecksum(payload);
    if (checksum !== computedChecksum) return null;

    return {
      type,
      id,
      timestamp: Date.now(),
      payload: Buffer.from(payload),
    };
  }

  encodeBatch(packets: Array<{ type: PacketType; payload: Buffer }>): Buffer {
    const encoded = packets.map(p => this.encode(p.type, p.payload));
    const totalLength = encoded.reduce((sum, buf) => sum + buf.length + 4, 0);
    const batch = Buffer.alloc(totalLength);
    let offset = 0;

    for (const packet of encoded) {
      batch.writeUInt32BE(packet.length, offset); offset += 4;
      packet.copy(batch, offset); offset += packet.length;
    }

    return this.encode(PacketType.BATCH, batch);
  }

  decodeBatch(batchPayload: Buffer): Packet[] {
    const packets: Packet[] = [];
    let offset = 0;

    while (offset < batchPayload.length) {
      if (offset + 4 > batchPayload.length) break;
      const packetLength = batchPayload.readUInt32BE(offset); offset += 4;
      if (offset + packetLength > batchPayload.length) break;
      const packetData = batchPayload.subarray(offset, offset + packetLength);
      const packet = this.decode(Buffer.from(packetData));
      if (packet) packets.push(packet);
      offset += packetLength;
    }

    return packets;
  }

  private nextSequence(): number {
    this.sequenceId = (this.sequenceId + 1) & 0xFFFF;
    return this.sequenceId;
  }

  private computeChecksum(data: Buffer): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum = (sum + data[i]) & 0xFF;
    }
    return sum;
  }

  static encodeJSON(data: unknown): Buffer {
    return Buffer.from(JSON.stringify(data), 'utf-8');
  }

  static decodeJSON<T = unknown>(buf: Buffer): T {
    return JSON.parse(buf.toString('utf-8')) as T;
  }
}
