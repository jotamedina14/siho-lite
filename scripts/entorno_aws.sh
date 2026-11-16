#!/usr/bin/env bash
# Se carga con `source scripts/entorno_aws.sh` desde los demás scripts.
# Usa SIEMPRE el perfil dedicado de la cuenta personal del proyecto (nunca perfiles de trabajo).
set -euo pipefail
export AWS_PROFILE="${SIHO_AWS_PROFILE:-siho}"
export AWS_REGION="us-east-1"
export AWS_DEFAULT_REGION="us-east-1"
export AWS_PAGER=""

CUENTA=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  echo "No hay sesión en el perfil '$AWS_PROFILE'. Corre: aws login --profile $AWS_PROFILE --region us-east-1" >&2
  exit 1
}
# La cuenta esperada se fija la primera vez en .aws-cuenta-siho (no versionado) para evitar desplegar en otra.
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$RAIZ/.aws-cuenta-siho" ]] && [[ "$(cat "$RAIZ/.aws-cuenta-siho")" != "$CUENTA" ]]; then
  echo "ALTO: el perfil '$AWS_PROFILE' apunta a la cuenta $CUENTA, pero el proyecto usa $(cat "$RAIZ/.aws-cuenta-siho")." >&2
  exit 1
fi
export CUENTA RAIZ
