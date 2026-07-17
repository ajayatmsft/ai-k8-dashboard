'use strict';
/*
 * Cluster health gathering: collects the raw data the health analyzer needs,
 * then runs the analysis. Shared by the /api/clusterHealth endpoint and the
 * getClusterHealth AI tool.
 */

const { kubectl, kubectlJSON } = require('../infra/kubectl');
const { nsArgs } = require('../util');
const { analyzeClusterHealth } = require('./health');

async function gatherClusterHealth({ ns } = {}) {
  const allNs = !ns || ns === '_all';
  const [podsData, nodesData, nodeTop, podTop, eventsData] = await Promise.all([
    kubectlJSON(['get', 'pods', ...nsArgs(ns), '-o', 'json']).catch(() => ({ items: [] })),
    kubectlJSON(['get', 'nodes', '-o', 'json']).catch(() => ({ items: [] })),
    kubectl(['top', 'nodes', '--no-headers']).catch(() => null),
    kubectl(['top', 'pods', ...nsArgs(ns), '--containers', '--no-headers']).catch(() => null),
    kubectlJSON(['get', 'events', ...nsArgs(ns), '-o', 'json']).catch(() => ({ items: [] })),
  ]);

  // Node memory attribution needs cluster-wide usage: which pods run on which
  // node and how much each uses. When a namespace is selected the scoped data
  // above only covers that namespace, so fetch all-namespaces data just for the
  // per-node breakdown (reuse the scoped data when already cluster-wide).
  let attrPods = podsData; let attrTop = podTop;
  if (!allNs) {
    [attrPods, attrTop] = await Promise.all([
      kubectlJSON(['get', 'pods', '--all-namespaces', '-o', 'json']).catch(() => ({ items: [] })),
      kubectl(['top', 'pods', '--all-namespaces', '--containers', '--no-headers']).catch(() => null),
    ]);
  }

  return analyzeClusterHealth({
    podsData, nodesData, nodeTop, podTop, eventsData,
    allNs, defaultNs: allNs ? null : ns,
    attribution: { podsData: attrPods, podTop: attrTop },
  });
}

module.exports = { gatherClusterHealth };
