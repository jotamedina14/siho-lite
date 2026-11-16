#!/usr/bin/env bash
# Crea el presupuesto de AWS Budgets (USD 20/mes) con alertas al 50 %, 80 % y 100 % del gasto real.
# Se crea fuera de Terraform a propósito: debe existir ANTES que cualquier recurso y seguir vigente
# después del `terraform destroy`. Uso: scripts/presupuesto.sh correo@ejemplo.com
source "$(dirname "$0")/entorno_aws.sh"
CORREO="${1:?Uso: scripts/presupuesto.sh correo@ejemplo.com}"
NOMBRE="SIHO-Lite-20USD"

if aws budgets describe-budget --account-id "$CUENTA" --budget-name "$NOMBRE" >/dev/null 2>&1; then
  echo "El presupuesto $NOMBRE ya existe."
  exit 0
fi

notificacion() {
  printf '{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":%s,"ThresholdType":"PERCENTAGE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"%s"}]}' "$1" "$CORREO"
}

aws budgets create-budget --account-id "$CUENTA" \
  --budget "{\"BudgetName\":\"$NOMBRE\",\"BudgetLimit\":{\"Amount\":\"20\",\"Unit\":\"USD\"},\"TimeUnit\":\"MONTHLY\",\"BudgetType\":\"COST\"}" \
  --notifications-with-subscribers "[$(notificacion 50),$(notificacion 80),$(notificacion 100)]"
echo "Presupuesto $NOMBRE creado: USD 20/mes, alertas al 50 %, 80 % y 100 %."
