import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFrpConfig } from '../../src/main/frpConfig.ts';
import type { FrpConfig } from '../../src/shared/ipcTypes.ts';

const config: FrpConfig = {
  serverAddr: 'frp.example.com',
  serverPort: 7000,
  remotePort: 6000,
  token: '',
  user: '',
  proxyName: 'cloudbox',
  tunnelType: 'tcp',
  customDomain: '',
  proxyProtocol: false,
  healthCheckMux: false,
};

describe('admin web guards', () => {
  it('refuses to generate an frp proxy targeting admin port 1250', () => {
    assert.throws(
      () => buildFrpConfig(config, 1250, 'http'),
      /1250/,
    );
  });
});
