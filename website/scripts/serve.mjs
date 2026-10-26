import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream, watch } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { siteRoot, outputRoot, aboutFile } from './build.mjs';
import { pathToFileURL } from 'node:url';

const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid port with --port 4173.');
const host = '127.0.0.1';
const mime = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.pdf':'application/pdf', '.ico':'image/x-icon',
  '.woff2':'font/woff2', '.ttf':'font/ttf', '.txt':'text/plain; charset=utf-8',
  '.avif':'image/avif', '.mp4':'video/mp4', '.m4v':'video/mp4', '.webm':'video/webm'
};

// Support one byte range, as used by browser video controls when seeking.
// null means a full response; false means the requested range is unsatisfiable.
function parseByteRange(header, size) {
  if (header === undefined) return null;
  if (typeof header !== 'string' || size === 0) return false;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return {start, end};
}
const buildFile = path.join(siteRoot, 'scripts', 'build.mjs');
let buildTask = null;
let queued = false;
let revision = 0;
let lastBuildError = null;
let activeReaders = 0;
let readersDrained;
async function waitForReaders() {
  if (activeReaders) await new Promise(resolve => { readersDrained = resolve; });
}
async function buildCurrentSource() {
  const source = pathToFileURL(buildFile);
  source.searchParams.set('modified', String((await stat(buildFile)).mtimeMs));
  const { buildSite } = await import(source.href);
  const result = await buildSite();
  revision += 1;
  lastBuildError = null;
  return result;
}
if (!process.argv.includes('--no-build')) {
  const result = await buildCurrentSource();
  console.log(`Built ${result.pages} pages.`);
}

const server = http.createServer(async (request, response) => {
  if (!['GET','HEAD'].includes(request.method)) {
    response.writeHead(405, {'Allow':'GET, HEAD'}); response.end(); return;
  }
  let reading = false;
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    if (url.pathname === '/.preview/status') {
      response.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({
        service: 'zhiyuan-ma-personal-website-preview', siteRoot, pid: process.pid,
        port, building: Boolean(buildTask), revision, lastBuildError
      }));
      return;
    }
    // A rebuild replaces dist. Keep requests waiting until the complete output is ready.
    while (buildTask) await buildTask;
    activeReaders += 1;
    reading = true;
    const decoded = decodeURIComponent(url.pathname);
    const filename = path.resolve(outputRoot, `.${decoded}`);
    if (filename !== outputRoot && !filename.startsWith(outputRoot + path.sep)) {
      response.writeHead(403); response.end('Forbidden'); return;
    }
    const info = await stat(filename);
    let target = filename;
    if (info.isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        response.writeHead(301, {'Location':url.pathname + '/' + url.search}); response.end(); return;
      }
      target = path.join(filename, 'index.html');
    }
    const targetInfo = info.isDirectory() ? await stat(target) : info;
    if (!targetInfo.isFile()) { response.writeHead(404); response.end('Page not found'); return; }
    const range = parseByteRange(request.headers.range, targetInfo.size);
    const headers = {
      'Content-Type':mime[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Accept-Ranges':'bytes'
    };
    if (range === false) {
      response.writeHead(416, {...headers, 'Content-Range':`bytes */${targetInfo.size}`, 'Content-Length':0});
      response.end();
      return;
    }
    const contentLength = range ? range.end - range.start + 1 : targetInfo.size;
    response.writeHead(range ? 206 : 200, {
      ...headers, 'Content-Length':contentLength,
      ...(range ? {'Content-Range':`bytes ${range.start}-${range.end}/${targetInfo.size}`} : {})
    });
    if (request.method === 'HEAD' || !contentLength) { response.end(); return; }
    await pipeline(createReadStream(target, range || undefined), response);
  } catch (error) {
    if (request.aborted || response.destroyed) return;
    if (response.headersSent) { response.destroy(error); return; }
    response.writeHead(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400, {'Content-Type':'text/plain; charset=utf-8'});
    response.end('Page not found');
  } finally {
    if (reading) {
      activeReaders -= 1;
      if (!activeReaders && readersDrained) {
        const resolve = readersDrained;
        readersDrained = undefined;
        resolve();
      }
    }
  }
});

const watchers = [];
let timer;
function rebuild() {
  if (buildTask) { queued = true; return buildTask; }
  buildTask = (async () => {
    do {
      queued = false;
      try { await waitForReaders(); await buildCurrentSource(); console.log('Updated. Refresh the browser to see changes.'); }
      catch (error) { lastBuildError = error.message; console.error(`Rebuild failed: ${error.message}`); }
    } while (queued);
  })().finally(() => { buildTask = null; });
  return buildTask;
}
function schedule() { clearTimeout(timer); timer = setTimeout(rebuild, 180); }
watchers.push(watch(path.join(siteRoot, 'src'), {recursive: true}, schedule));
watchers.push(watch(path.join(siteRoot, 'public'), {recursive: true}, schedule));
watchers.push(watch(siteRoot, (_event, filename) => { if (filename === 'site.config.json') schedule(); }));
watchers.push(watch(path.dirname(aboutFile), (_event, filename) => { if (filename === path.basename(aboutFile)) schedule(); }));
watchers.push(watch(path.dirname(buildFile), (_event, filename) => { if (filename === path.basename(buildFile)) schedule(); }));
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Run again with --port ${port + 1}.` : error.message);
  watchers.forEach(watcher => watcher.close()); process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`Local: http://${host}:${port}/`);
  console.log('Watching content, assets and page generator. Use the stop-preview launcher to stop a background preview.');
});
function close() {
  clearTimeout(timer); watchers.forEach(watcher => watcher.close());
  server.close(() => process.exit(0));
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
