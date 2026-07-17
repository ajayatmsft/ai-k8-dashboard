'use strict';
/*
 * Process runners for the kubectl and helm binaries. The ONLY place the
 * backend spawns cluster tooling. All invocations use execFile/spawn with an
 * argv array (never a shell string), so values from the UI cannot inject
 * shell commands on the host.
 */

const { execFile } = require('child_process');
const { KUBECTL, HELM, MAX_BUFFER, KUBECTL_TIMEOUT } = require('../config');
const { globalArgs, loadSettings } = require('../settings');

function kubectl(args, { timeout } = {}) {
  const full = [...globalArgs(), ...args];
  return new Promise((resolve, reject) => {
    execFile(
      KUBECTL, full,
      { maxBuffer: MAX_BUFFER, timeout: timeout || KUBECTL_TIMEOUT, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error((stderr || err.message || '').trim());
          e.code = err.code; e.stderr = stderr; e.stdout = stdout;
          return reject(e);
        }
        resolve(stdout);
      }
    );
  });
}
async function kubectlJSON(args) { return JSON.parse(await kubectl(args)); }

// kubectl that ignores global context (used when probing a specific kubeconfig)
function kubectlRaw(args, extraGlobal = [], { timeout } = {}) {
  const full = [...extraGlobal, ...args];
  return new Promise((resolve, reject) => {
    execFile(KUBECTL, full,
      { maxBuffer: MAX_BUFFER, timeout: timeout || KUBECTL_TIMEOUT, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) { const e = new Error((stderr || err.message).trim()); e.stderr = stderr; return reject(e); }
        resolve(stdout);
      });
  });
}

// Optional `helm` binary runner (mirrors kubectl context/kubeconfig flags).
// Helm honours the same --kubeconfig/--kube-context style flags; we pass the
// kubeconfig/context selected in the UI so it targets the same cluster.
function helm(args, { timeout } = {}) {
  const s = loadSettings();
  const full = [];
  if (s.kubeconfig) full.push('--kubeconfig', s.kubeconfig);
  if (s.context) full.push('--kube-context', s.context);
  full.push(...args);
  return new Promise((resolve, reject) => {
    execFile(
      HELM, full,
      { maxBuffer: MAX_BUFFER, timeout: timeout || KUBECTL_TIMEOUT, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error((stderr || err.message || '').trim());
          e.code = err.code; e.stderr = stderr; e.notFound = err.code === 'ENOENT';
          return reject(e);
        }
        resolve(stdout);
      }
    );
  });
}

module.exports = { kubectl, kubectlJSON, kubectlRaw, helm };
