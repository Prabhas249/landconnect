// Joins a LiveKit room from a headless Chrome, so a call can be demonstrated without a second person.
// 'camera' sends the laptop camera with the microphone off; 'test' sends Chrome's fake test pattern and tone.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const files = {
  '/join.html': ['text/html', new URL('./join.html', import.meta.url)],
  '/livekit-client.umd.js': [
    'text/javascript',
    new URL('../../node_modules/livekit-client/dist/livekit-client.umd.js', import.meta.url),
  ],
};

let server = null;
let profile = null;

function serve() {
  if (server) return Promise.resolve(server.address().port);
  server = createServer((req, res) => {
    const file = files[new URL(req.url, 'http://localhost').pathname];
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': file[0] }).end(readFileSync(file[1]));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

export async function joinWithTestMedia(url, token, source = 'camera') {
  leaveTestMedia();
  const port = await serve();
  const page = `http://127.0.0.1:${port}/join.html?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}&mic=${source === 'test' ? 1 : 0}`;
  profile = mkdtempSync(join(tmpdir(), 'call-partner-'));
  const flags = ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`];
  if (source === 'test') {
    spawn(CHROME, ['--headless=new', '--use-fake-device-for-media-stream', ...flags, page], { stdio: 'ignore' });
  } else {
    // Launched through `open` so macOS checks Chrome's own camera permission, not the terminal's.
    spawn('open', ['-na', 'Google Chrome', '--args', '--no-first-run', '--window-size=480,360', ...flags, page], {
      stdio: 'ignore',
    });
  }
  console.log(source === 'test' ? 'Joined with the test pattern and tone.' : 'Joined with the laptop camera (microphone off).');
}

export function leaveTestMedia() {
  if (profile) spawnSync('pkill', ['-f', profile]);
  profile = null;
}

process.on('exit', leaveTestMedia);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
