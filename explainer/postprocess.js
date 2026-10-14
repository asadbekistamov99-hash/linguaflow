'use strict';
// Converts out/linguaflow-explainer.webm to MP4 and writes subtitles (SRT) + a voice-over script from timeline.json.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const OUT = path.join(__dirname, 'out');
const webm = path.join(OUT, 'linguaflow-explainer.webm');
const mp4 = path.join(OUT, 'LinguaFlow-tanishuv-videosi.mp4');
const r = spawnSync('ffmpeg', ['-y', '-i', webm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', '25', '-movflags', '+faststart', '-an', mp4], { stdio: 'inherit' });
if (r.status !== 0) process.exit(1);
const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).stdout.toString()) * 1000;
const tl = JSON.parse(fs.readFileSync(path.join(OUT, 'timeline.json'), 'utf8')).filter((x) => x.text);
const ts = (ms) => { const d = new Date(Math.max(0, ms)); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())},${p(d.getUTCMilliseconds(), 3)}`; };
// the recorder's clock starts a little before the first video frame; shift so the first caption lines up
const first = tl.length ? tl[0].at : 0;
const shift = Number(process.env.SHIFT_MS || 0);
let srt = '', script = 'LinguaFlow tanishuv videosi: ovoz yozish matni\n\n';
tl.forEach((c, i) => {
  const start = c.at + shift, end = Math.min((tl[i + 1] ? tl[i + 1].at : dur) + shift, start + 9000);
  srt += `${i + 1}\n${ts(start)} --> ${ts(end)}\n${c.text}${c.sub ? '\n' + c.sub : ''}\n\n`;
  script += `[${ts(start).slice(3, 8)}] ${c.text}. ${c.sub}\n\n`;
});
fs.writeFileSync(path.join(OUT, 'LinguaFlow-subtitrlar.srt'), srt);
fs.writeFileSync(path.join(OUT, 'LinguaFlow-ovoz-matni.txt'), script);
console.log('mp4', mp4, Math.round(dur / 1000) + 's', 'captions', tl.length);
