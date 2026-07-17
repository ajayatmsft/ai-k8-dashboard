'use strict';
/*
 * Cluster add-on detection: correlates CRD API groups with system-namespace
 * workloads against a signature list of well-known operators/add-ons.
 */

const { kubectlJSON } = require('../infra/kubectl');

const ADDON_SIGNATURES = [
  { name: 'ingress-nginx', category: 'Ingress', match: /ingress-nginx|nginx-ingress/i },
  { name: 'Traefik', category: 'Ingress', match: /traefik/i },
  { name: 'cert-manager', category: 'Certificates', match: /cert-manager/i, group: /cert-manager\.io/i },
  { name: 'metrics-server', category: 'Metrics', match: /metrics-server/i },
  { name: 'CoreDNS', category: 'DNS', match: /coredns|kube-dns/i },
  { name: 'Calico', category: 'CNI / Network', match: /calico/i, group: /projectcalico\.org|crd\.projectcalico/i },
  { name: 'Cilium', category: 'CNI / Network', match: /cilium/i, group: /cilium\.io/i },
  { name: 'Azure CNI', category: 'CNI / Network', match: /azure-cni|azure-npm/i },
  { name: 'Istio', category: 'Service Mesh', match: /istiod|istio-/i, group: /istio\.io/i },
  { name: 'Linkerd', category: 'Service Mesh', match: /linkerd/i, group: /linkerd\.io/i },
  { name: 'Prometheus', category: 'Observability', match: /prometheus/i, group: /monitoring\.coreos\.com/i },
  { name: 'Grafana', category: 'Observability', match: /grafana/i },
  { name: 'OpenTelemetry', category: 'Observability', match: /opentelemetry|otel-/i, group: /opentelemetry\.io/i },
  { name: 'Cluster Autoscaler', category: 'Scaling', match: /cluster-autoscaler/i },
  { name: 'KEDA', category: 'Scaling', match: /keda/i, group: /keda\.sh/i },
  { name: 'Gatekeeper / OPA', category: 'Policy', match: /gatekeeper|opa\b/i, group: /gatekeeper\.sh/i },
  { name: 'Azure Policy', category: 'Policy', match: /azure-policy/i },
  { name: 'aad-pod-identity', category: 'Identity', match: /nmi|mic\b|aad-pod-identity/i, group: /aadpodidentity\.k8s\.io/i },
  { name: 'Azure Workload Identity', category: 'Identity', match: /azure-wi-webhook|workload-identity/i },
  { name: 'Secrets Store CSI', category: 'Secrets', match: /secrets-store|csi-secrets/i, group: /secrets-store\.csi\.x-k8s\.io/i },
  { name: 'CSI Driver', category: 'Storage', match: /csi-.*driver|csi-azuredisk|csi-azurefile|ebs-csi|efs-csi/i },
  { name: 'Azure Monitor (ama-logs)', category: 'Observability', match: /ama-logs|omsagent/i },
  { name: 'Konnectivity', category: 'AKS System', match: /konnectivity/i },
  { name: 'Flux', category: 'GitOps', match: /flux|source-controller|kustomize-controller/i, group: /toolkit\.fluxcd\.io/i },
  { name: 'Argo CD', category: 'GitOps', match: /argocd/i, group: /argoproj\.io/i },
];

const SYSTEM_NS = /^(kube-system|kube-public|kube-node-lease|cert-manager|ingress-nginx|istio-system|linkerd|monitoring|gatekeeper-system|calico-system|tigera-operator|azure-workload-identity-system|kube-flannel|gmp-system|flux-system|argocd)$/i;

// Detect installed add-ons by correlating CRDs + system workloads.
async function detectAddons() {
  const [crds, deployments, daemonsets] = await Promise.all([
    kubectlJSON(['get', 'crd', '-o', 'json']).catch(() => ({ items: [] })),
    kubectlJSON(['get', 'deployments', '--all-namespaces', '-o', 'json']).catch(() => ({ items: [] })),
    kubectlJSON(['get', 'daemonsets', '--all-namespaces', '-o', 'json']).catch(() => ({ items: [] })),
  ]);

  // CRD API groups → indicates installed operators/add-ons.
  const groupCounts = {};
  for (const c of crds.items || []) {
    const group = (c.spec && c.spec.group) || '';
    if (!group) continue;
    groupCounts[group] = (groupCounts[group] || 0) + 1;
  }
  const crdGroups = Object.entries(groupCounts)
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => b.count - a.count);

  // System workloads (live in system namespaces) = the cluster's add-on plane.
  const systemWorkloads = [];
  const addWorkload = (kind) => (w) => {
    const ns = w.metadata.namespace;
    if (!SYSTEM_NS.test(ns)) return;
    systemWorkloads.push({ kind, namespace: ns, name: w.metadata.name,
      images: (((w.spec && w.spec.template && w.spec.template.spec && w.spec.template.spec.containers) || []).map((c) => c.image)) });
  };
  (deployments.items || []).forEach(addWorkload('Deployment'));
  (daemonsets.items || []).forEach(addWorkload('DaemonSet'));

  // Run the signature matcher across all evidence.
  const haystack = [
    ...crdGroups.map((g) => g.group),
    ...systemWorkloads.map((w) => w.name),
  ];
  const detected = [];
  for (const sig of ADDON_SIGNATURES) {
    const byName = haystack.some((h) => sig.match.test(h));
    const byGroup = sig.group && crdGroups.some((g) => sig.group.test(g.group));
    if (byName || byGroup) {
      const evidence = [];
      const wl = systemWorkloads.find((w) => sig.match.test(w.name));
      if (wl) evidence.push(`${wl.kind} ${wl.namespace}/${wl.name}`);
      const grp = sig.group && crdGroups.find((g) => sig.group.test(g.group));
      if (grp) evidence.push(`CRD group ${grp.group} (${grp.count})`);
      detected.push({ name: sig.name, category: sig.category, evidence });
    }
  }
  detected.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  return { detected, crdGroups, systemWorkloads };
}

module.exports = { detectAddons };
