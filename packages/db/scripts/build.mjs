import { spawnSync } from 'node:child_process';

/** prisma generate needs DATABASE_URL present even though it does not connect. */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://postgres:postgres@127.0.0.1:5432/datazone?schema=public';
}

function run(command) {
  const result = spawnSync(command, {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('npx prisma generate');
run('npx tsc -p tsconfig.json');
