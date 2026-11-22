import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseProxyV2Source } from '../../src/main/proxyProtocolServer.ts';

function header(family: number, source: number[], destination: number[]): Buffer {
  const addressLength = family === 0x11 ? 12 : 36;
  const buffer = Buffer.alloc(16 + addressLength);
  Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a]).copy(buffer);
  buffer[12] = 0x21;
  buffer[13] = family;
  buffer.writeUInt16BE(addressLength, 14);
  Buffer.from(source).copy(buffer, 16);
  Buffer.from(destination).copy(buffer, family === 0x11 ? 20 : 32);
  return buffer;
}

describe('PROXY protocol v2 source', () => {
  it('reads the IPv4 source, not the destination', () => {
    const packet = header(0x11, [203, 0, 113, 9], [172, 25, 38, 131]);
    assert.equal(parseProxyV2Source(packet), '203.0.113.9');
  });

  it('reads the IPv6 source, not the destination', () => {
    const source = Buffer.from('20010db8000000000000000000000001', 'hex');
    const destination = Buffer.from('20010db8000000000000000000000002', 'hex');
    const packet = header(0x21, [...source], [...destination]);
    assert.equal(parseProxyV2Source(packet), '2001:db8:0:0:0:0:0:1');
  });

  it('rejects a LOCAL command and truncated headers', () => {
    const packet = header(0x11, [203, 0, 113, 9], [172, 25, 38, 131]);
    packet[12] = 0x20;
    assert.equal(parseProxyV2Source(packet), null);
    assert.equal(parseProxyV2Source(Buffer.alloc(10)), null);
  });
});
