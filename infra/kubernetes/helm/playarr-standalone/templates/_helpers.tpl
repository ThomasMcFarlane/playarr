{{- define "playarr-standalone.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "playarr-standalone.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "playarr-standalone.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "playarr-standalone.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/name: {{ include "playarr-standalone.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "playarr-standalone.selectorLabels" -}}
app.kubernetes.io/name: {{ include "playarr-standalone.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "playarr-standalone.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "playarr-standalone.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "playarr-standalone.claimName" -}}
{{- if .Values.persistence.existingClaim }}
{{- .Values.persistence.existingClaim }}
{{- else }}
{{- include "playarr-standalone.fullname" . }}
{{- end }}
{{- end }}

{{- define "playarr-standalone.localVolumeName" -}}
{{- default (include "playarr-standalone.fullname" .) .Values.persistence.local.volumeName }}
{{- end }}

{{- define "playarr-standalone.image" -}}
{{- if .Values.image.digest }}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest }}
{{- else }}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}
{{- end }}
