import { loadConfig } from './config/index.js';
import { createApp } from './app.js';

const config = loadConfig();
const { app } = createApp(config);

app.listen(config.port, () => {
  console.log(`Sovereign Drive listening on :${config.port} (driver=${config.storage.driver})`);
});
