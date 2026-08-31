import { spawn } from 'node:child_process';

const port = String(process.env.PORT ?? 4173);
const child = spawn(
  'npx',
  ['vite', 'preview', '--host', '0.0.0.0', '--port', port],
  { stdio: 'inherit', shell: true, env: process.env },
);

child.on('exit', (code) => process.exit(code ?? 1));
