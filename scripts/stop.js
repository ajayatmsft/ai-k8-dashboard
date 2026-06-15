#!/usr/bin/env node
/* Kill whatever process is currently listening on PORT (default 7575). */
'use strict';
const { execSync } = require('child_process');

const PORT = parseInt(process.env.PORT || '7575', 10);
const isWin = process.platform === 'win32';

function sh(cmd) {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); }
  catch { return ''; }
}

function pidsOnPort(port) {
  const pids = new Set();
  if (isWin) {
    const out = sh(`netstat -ano -p tcp`);
    for (const line of out.split(/\r?\n/)) {
      // proto  local           foreign         state       pid
      const m = line.trim().match(/^\S+\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
      if (m && parseInt(m[1], 10) === port) pids.add(m[2]);
    }
  } else {
    const out = sh(`lsof -tiTCP:${port} -sTCP:LISTEN`);
    for (const p of out.split(/\s+/)) if (p) pids.add(p);
  }
  return [...pids];
}

const pids = pidsOnPort(PORT);
if (!pids.length) {
  console.log(`No process listening on port ${PORT}.`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    if (isWin) execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    else execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    console.log(`Killed PID ${pid} on port ${PORT}.`);
  } catch (e) {
    console.error(`Failed to kill PID ${pid}: ${e.message}`);
  }
}

