/**
 * The desktop app: the built site (dist/, with all its art, audio and campaign media) served to a window from a
 * small local web server. A server rather than file:// because the app fetches its manifests and streams video
 * and audio, which need http (and Range requests). The port is fixed so saves (localStorage) survive updates.
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'dist');
// Which edition was built into dist/ (scripts/build-desktop.mjs writes it): the tabletop edition gets its own title
// and its own port, so its saves (kept per port) never mix with the full app's.
let EDITION = 'full';
try { EDITION = JSON.parse(fs.readFileSync(path.join(ROOT, 'edition.json'), 'utf8')).edition || 'full'; } catch { /* the full app */ }
const TITLE = EDITION === 'tabletop' ? 'Co-op Command Tabletop' : 'SC TMG Co-op Command';
const PORT = EDITION === 'tabletop' ? 47232 : 47231;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.woff': 'font/woff',
};

function serve(req, res) {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url.endsWith('/')) url += 'index.html';
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // The app routes on the client: anything unknown gets the page.
      if (!path.extname(url)) return fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res.writeHead(200, { 'Content-Type': MIME['.html'] }) && res);
      res.writeHead(404); return res.end();
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      // Media seeking: the requested slice of the file.
      const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(serve);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function start() {
  let port;
  try { port = await listen(PORT); } catch { port = await listen(0); }
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#050a14', title: TITLE,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.setMenuBarVisibility(false);
  // The game's Menu has Quit and Full screen (the page calls these); F11 toggles full screen, Ctrl/Cmd+Q quits.
  ipcMain.on('desktop:quit', () => app.quit());
  ipcMain.on('desktop:fullscreen', () => win.setFullScreen(!win.isFullScreen()));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if ((input.control || input.meta) && input.key.toLowerCase() === 'q') { app.quit(); e.preventDefault(); }
  });
  // Links to the outside world open in the browser, not in the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(start);
app.on('window-all-closed', () => app.quit());
