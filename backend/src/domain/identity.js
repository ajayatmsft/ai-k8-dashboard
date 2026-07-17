'use strict';
/*
 * Service accounts and pod-attached cloud identities: Azure Workload Identity,
 * legacy AAD Pod Identity, AWS IRSA, and GCP Workload Identity.
 */

const { kubectlJSON } = require('../infra/kubectl');
const { nsArgs, age } = require('../util');

// Identity-related annotations across the major clouds + workload identity.
function identityAnnotations(annotations = {}) {
  const out = {};
  if (annotations['azure.workload.identity/client-id']) out.azureClientId = annotations['azure.workload.identity/client-id'];
  if (annotations['azure.workload.identity/tenant-id']) out.azureTenantId = annotations['azure.workload.identity/tenant-id'];
  if (annotations['eks.amazonaws.com/role-arn']) out.awsRoleArn = annotations['eks.amazonaws.com/role-arn'];
  if (annotations['iam.gke.io/gcp-service-account']) out.gcpServiceAccount = annotations['iam.gke.io/gcp-service-account'];
  return out;
}

async function listServiceAccounts({ ns } = {}) {
  const data = await kubectlJSON(['get', 'serviceaccounts', ...nsArgs(ns), '-o', 'json']);
  return { items: (data.items || []).map((sa) => {
    const ann = (sa.metadata && sa.metadata.annotations) || {};
    const identity = identityAnnotations(ann);
    return {
      namespace: sa.metadata.namespace, name: sa.metadata.name,
      secrets: ((sa.secrets || []).map((s) => s.name)),
      automount: sa.automountServiceAccountToken !== false,
      identity, hasIdentity: Object.keys(identity).length > 0,
      age: age(sa.metadata.creationTimestamp),
    };
  }).sort((a, b) => (b.hasIdentity - a.hasIdentity) || (a.namespace + a.name).localeCompare(b.namespace + b.name)) };
}

// Correlates workload identity (annotated SAs + pods opting in) and the legacy
// AAD Pod Identity model (AzureIdentity CRDs + aadpodidbinding labels).
async function listPodIdentities({ ns } = {}) {
  const [saData, podData] = await Promise.all([
    kubectlJSON(['get', 'serviceaccounts', ...nsArgs(ns), '-o', 'json']).catch(() => ({ items: [] })),
    kubectlJSON(['get', 'pods', ...nsArgs(ns), '-o', 'json']).catch(() => ({ items: [] })),
  ]);

  // Map SA -> identity annotations.
  const saIdentity = new Map();
  for (const sa of saData.items || []) {
    const id = identityAnnotations((sa.metadata && sa.metadata.annotations) || {});
    if (Object.keys(id).length) saIdentity.set(`${sa.metadata.namespace}/${sa.metadata.name}`, id);
  }

  const workloadIdentity = [];
  for (const p of podData.items || []) {
    const labels = (p.metadata && p.metadata.labels) || {};
    const saName = (p.spec && p.spec.serviceAccountName) || 'default';
    const key = `${p.metadata.namespace}/${saName}`;
    const id = saIdentity.get(key);
    const usesWI = labels['azure.workload.identity/use'] === 'true';
    if (id || usesWI) {
      workloadIdentity.push({
        namespace: p.metadata.namespace, pod: p.metadata.name,
        serviceAccount: saName, usesWorkloadIdentity: usesWI,
        identity: id || null,
      });
    }
  }

  // Legacy AAD Pod Identity (best-effort; CRD may not exist).
  let azureIdentities = [];
  try {
    const ai = await kubectlJSON(['get', 'azureidentity', ...nsArgs(ns), '-o', 'json']);
    azureIdentities = (ai.items || []).map((x) => ({
      namespace: x.metadata.namespace, name: x.metadata.name,
      clientId: x.spec && x.spec.clientID, resourceId: x.spec && x.spec.resourceID, type: x.spec && x.spec.type,
    }));
  } catch (_) { /* CRD absent */ }

  const podIdentityBindings = [];
  for (const p of podData.items || []) {
    const labels = (p.metadata && p.metadata.labels) || {};
    if (labels.aadpodidbinding) {
      podIdentityBindings.push({ namespace: p.metadata.namespace, pod: p.metadata.name, binding: labels.aadpodidbinding });
    }
  }

  return {
    workloadIdentity,
    azureIdentities,
    podIdentityBindings,
    serviceAccountsWithIdentity: [...saIdentity.entries()].map(([k, id]) => {
      const [namespace, name] = k.split('/');
      return { namespace, name, identity: id };
    }),
  };
}

module.exports = { identityAnnotations, listServiceAccounts, listPodIdentities };
