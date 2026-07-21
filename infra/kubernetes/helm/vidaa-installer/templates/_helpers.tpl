{{/* Expand the chart name. */}}
{{- define "vidaa-installer.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Create a release-scoped resource name. */}}
{{- define "vidaa-installer.fullname" -}}
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

{{/* Chart label value. */}}
{{- define "vidaa-installer.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Labels shared by every resource. */}}
{{- define "vidaa-installer.labels" -}}
helm.sh/chart: {{ include "vidaa-installer.chart" . }}
app.kubernetes.io/name: {{ include "vidaa-installer.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: playarr
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Label that associates only this Mapping with this wildcard Host. */}}
{{- define "vidaa-installer.routeLabel" -}}
playarr.app/vidaa-route: portal
{{- end -}}
