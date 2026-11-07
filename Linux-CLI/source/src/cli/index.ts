#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { hashPassword } from '../core/security/password.ts';
import { openServices, resolveDataDir, startHeadless } from '../server/headless.ts';
import { readConfig, writeConfig } from './config.ts';

const program = new Command();
program
  .name('cloudbox')
  .description('CloudBox headless Linux server')
  .version('0.1.0-linux')
  .option('--portable', 'use ./data instead of /var/lib/cloudbox', false)
  .option('--data-dir <dir>', 'override data directory');

function globalOptions() {
  const raw = program.opts() as { portable?: boolean; dataDir?: string };
  return { portable: raw.portable ?? false, dataDir: raw.dataDir };
}

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!hidden) return (await rl.question(question)).trim();
    process.stdout.write(question);
    return await new Promise<string>((resolve) => {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      let value = '';
      const onData = (char: string) => {
        if (char === '\r' || char === '\n') {
          process.stdin.off('data', onData);
          process.stdin.setRawMode?.(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve(value);
        } else if (char === '\u0003') {
          process.exit(1);
        } else {
          value += char;
        }
      };
      process.stdin.on('data', onData);
    });
  } finally {
    rl.close();
  }
}

program
  .command('init')
  .description('initialize database and administrator')
  .option('--username <name>', 'administrator username')
  .option('--password <password>', 'administrator password')
  .action(async (options: { username?: string; password?: string }) => {
    const global = globalOptions();
    const opened = openServices({ portable: global.portable, dataDir: global.dataDir });
    try {
      if (opened.services.users.findAdmin() !== null) {
        console.error('Administrator already exists. Use reset-admin to reset the password.');
        process.exitCode = 1;
        return;
      }
      const username = options.username ?? ((await prompt('Admin username [admin]: ')) || 'admin');
      const password = options.password ?? (await prompt('Admin password: ', true));
      if (password.length < 8) throw new Error('Password must be at least 8 characters');
      const now = Date.now();
      const storageKey = randomUUID();
      const user = opened.services.users.create({
        storageKey,
        username,
        displayName: username,
        passwordHash: await hashPassword(password),
        role: 'admin',
        status: 'active',
        createdAt: now,
      });
      opened.services.quotas.ensure(user.id, null, now);
      mkdirSync(path.join(opened.dataDir, 'storage', storageKey), { recursive: true });
      console.log(`✔ Administrator "${username}" created at ${opened.dataDir}`);
    } finally {
      opened.close();
    }
  });

program
  .command('start')
  .description('start headless CloudBox')
  .option('--port <port>', 'listen port')
  .option('--host <host>', 'listen host', '0.0.0.0')
  .action(async (options: { port?: string; host: string }) => {
    const global = globalOptions();
    const config = readConfig(global.portable, global.dataDir);
    const port = options.port ? Number(options.port) : config.port;
    const running = await startHeadless({
      portable: global.portable,
      dataDir: global.dataDir,
      port,
      host: options.host,
    });
    const shutdown = () => {
      running.server.close(() => {
        running.services.db.close();
        process.exit(0);
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });

const config = program.command('config').description('read or write config');
config
  .command('get [key]')
  .action((key?: string) => {
    const global = globalOptions();
    const value = readConfig(global.portable, global.dataDir) as unknown as Record<string, unknown>;
    console.log(JSON.stringify(key ? { [key]: value[key] } : value, null, 2));
  });
config
  .command('set <key> <value>')
  .action((key: string, value: string) => {
    const global = globalOptions();
    if (key === 'port') {
      console.log(JSON.stringify(writeConfig(global.portable, global.dataDir, { port: Number(value) })));
    } else if (key === 'host') {
      console.log(JSON.stringify(writeConfig(global.portable, global.dataDir, { host: value })));
    } else {
      throw new Error('Supported config keys: port, host');
    }
  });

program
  .command('reset-admin')
  .description('reset administrator password')
  .option('--password <password>', 'new password')
  .action(async (options: { password?: string }) => {
    const global = globalOptions();
    const opened = openServices({ portable: global.portable, dataDir: global.dataDir });
    try {
      const admin = opened.services.users.findAdmin();
      if (!admin) throw new Error('Administrator not found');
      const password = options.password ?? (await prompt('New admin password: ', true));
      await opened.services.auth.resetPassword({
        userId: admin.id,
        newPassword: password,
        mustChangePassword: false,
        actorType: 'system',
      });
      console.log(`✔ Administrator "${admin.username}" password reset`);
    } finally {
      opened.close();
    }
  });

const plugin = program.command('plugin').description('manage plugins');
plugin.command('list').action(() => {
  const global = globalOptions();
  const opened = openServices({ portable: global.portable, dataDir: global.dataDir });
  try {
    for (const item of opened.services.plugins.list()) {
      console.log(`${item.enabled ? 'enabled ' : 'disabled'} ${item.name}@${item.version}`);
    }
  } finally {
    opened.close();
  }
});
for (const action of ['enable', 'disable'] as const) {
  plugin.command(`${action} <name>`).action(async (name: string) => {
    const global = globalOptions();
    const opened = openServices({ portable: global.portable, dataDir: global.dataDir });
    try {
      await opened.services.plugins.setEnabled(name, action === 'enable');
      console.log(`✔ ${name} ${action}d`);
    } finally {
      opened.close();
    }
  });
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
