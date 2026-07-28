{{/*
Expand the name of the chart.
*/}}
{{- define "playarr.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name. Truncated at 63 chars because
some Kubernetes name fields are limited to this (by the DNS naming spec).
*/}}
{{- define "playarr.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "playarr.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels
*/}}
{{- define "playarr.labels" -}}
helm.sh/chart: {{ include "playarr.chart" . }}
{{ include "playarr.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/*
Selector labels (stable subset used by Deployment/Service selectors -
must never change across releases).
*/}}
{{- define "playarr.selectorLabels" -}}
app.kubernetes.io/name: {{ include "playarr.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Component-specific selector labels (adds api|worker on top of the base
selector labels). Expects a dict with "context" (the root .) and
"component" (e.g. "api" or "worker").
*/}}
{{- define "playarr.componentSelectorLabels" -}}
{{ include "playarr.selectorLabels" .context }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
Component-specific full labels.
*/}}
{{- define "playarr.componentLabels" -}}
{{ include "playarr.labels" .context }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
Name of the ServiceAccount to use.
*/}}
{{- define "playarr.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{ default (include "playarr.fullname" .) .Values.serviceAccount.name }}
{{- else -}}
{{ default "default" .Values.serviceAccount.name }}
{{- end -}}
{{- end -}}

{{/*
Name of the Secret holding DATABASE_URL / REDIS_URL.
*/}}
{{- define "playarr.secretName" -}}
{{- default (printf "%s-secrets" (include "playarr.fullname" .)) .Values.secret.name -}}
{{- end -}}

{{/*
Name of the ConfigMap holding non-secret config.
*/}}
{{- define "playarr.configMapName" -}}
{{- printf "%s-config" (include "playarr.fullname" .) -}}
{{- end -}}
