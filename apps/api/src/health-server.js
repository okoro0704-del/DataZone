import http from 'node:http';

/**
 * Minimal process so Railway/Railpack has a valid start command.
 * @hospitalityos/api is a library (RemoteSovereignDriveAdapter), not a product API.
 */
const port = Number(process.env.PORT ?? 3000);
http
  .createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: '@hospitalityos/api', role: 'library' }));
  })
  .listen(port, () => {
    console.log(`@hospitalityos/api health stub on :${port}`);
  });
