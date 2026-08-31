import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const { app } = createApp(config);

app.listen(config.port, () => {
  console.log(`Data Zone (Media Drive) listening on :${config.port}`);
});
