# Playarr development Helm chart

This chart captures the four development web surfaces previously maintained as
ad-hoc resources in the `dev` namespace. It creates four Deployments, four
ClusterIP Services and ten Emissary `Mapping` resources in the Helm release
namespace.

```sh
helm upgrade --install playarr-dev ./infra/kubernetes/helm/playarr-dev \
  --namespace playarr --create-namespace
```

The chart contains no Secrets and the live workloads do not reference any
Secrets or ConfigMaps. Public and LAN DNS are external prerequisites; this
chart manages only the matching Emissary routes.

Two defaults deliberately preserve the current dev-host development behaviour:

- `playarr` requires `/tmp/streamarr-unsorted-folders` to exist as a directory
  on the scheduled node.
- `playarr-marketing` requires the two configured `/path/to/streamarr/site`
  directories on the scheduled node.

If those paths do not exist, Kubernetes leaves the Pods in
`ContainerCreating` with `FailedMount`, as it does in the source deployment.
Changing them is a separate operational decision. None of these Pods requests
`hostNetwork` or `hostPort`; port 8080 is a pod-local container port.
