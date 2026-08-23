{{- define "playarr-dev.labels" -}}
app.kubernetes.io/part-of: playarr
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end }}

{{- define "playarr-dev.regionalLabels" -}}
app.kubernetes.io/name: playarr-standalone
app.kubernetes.io/instance: {{ .name }}
{{ include "playarr-dev.labels" .context }}
{{- end }}
