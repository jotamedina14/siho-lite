#!/usr/bin/env bash
# Pruebas manuales de seguridad del plan de pruebas (sección 7), contra la URL pública.
# Guarda la salida en docs/evidencias/seguridad.txt (luego se convierte en captura).
source "$(dirname "$0")/entorno_aws.sh"
cd "$RAIZ"
URL=$(terraform -chdir=infra output -raw url_app)
ALB=$(terraform -chdir=infra output -raw alb_dns)
BUCKET=$(terraform -chdir=infra output -raw bucket_documentos)
TOKEN_MEDICO=$(.venv/bin/python -c "import sys; sys.path.insert(0,'loadtest'); from cognito import obtener_token; print(obtener_token('medico')['idToken'])")
mkdir -p docs/evidencias
SALIDA=docs/evidencias/seguridad.txt

paso() { printf '\n$ %s\n' "$1"; }
codigo() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

{
  echo "SIHO Lite - pruebas de seguridad contra $URL"
  echo "Fecha: $(TZ=America/Bogota date '+%Y-%m-%d %H:%M:%S') (hora de Colombia)"

  paso "curl -I http://${URL#https://}/health    # HTTP se redirige a HTTPS"
  curl -sI "http://${URL#https://}/health" | grep -iE '^(HTTP|location)'

  paso "curl -I $URL/health    # cabeceras de seguridad"
  curl -sI "$URL/health" | grep -iE '^(HTTP|strict-transport|x-content-type|x-frame|referrer-policy|content-security|x-task-id|x-az|via)'

  paso "curl $URL/health"
  curl -s "$URL/health"; echo

  paso "curl $URL/api/pacientes    # sin token"
  echo "HTTP $(codigo "$URL/api/pacientes")  -> 401 no autenticado"

  paso "curl $URL/api/pacientes -H 'Authorization: Bearer <token falso>'"
  echo "HTTP $(codigo "$URL/api/pacientes" -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.x')  -> 401 token inválido"

  paso "curl -X POST $URL/api/pacientes -H 'Authorization: Bearer <token rol medico>'    # rol sin permiso"
  echo "HTTP $(codigo -X POST "$URL/api/pacientes" -H "Authorization: Bearer $TOKEN_MEDICO" -H 'content-type: application/json' -d '{}')  -> 403 prohibido (médico no crea pacientes)"

  paso "curl $URL/api/reportes/ocupacion -H 'Authorization: Bearer <token rol medico>'"
  echo "HTTP $(codigo "$URL/api/reportes/ocupacion" -H "Authorization: Bearer $TOKEN_MEDICO")  -> 403 (solo admin)"

  paso "curl $URL/api/info -H 'Authorization: Bearer <token rol medico>'    # token válido de Cognito"
  curl -s "$URL/api/info" -H "Authorization: Bearer $TOKEN_MEDICO" | jq -c '{taskId, az, version, usuario}'

  paso "curl \"$URL/api/pacientes?q=' OR 1=1--\"    # inyección SQL: la bloquea el WAF antes de llegar a la API"
  curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$URL/api/pacientes?q=%27%20OR%201%3D1--" -H "Authorization: Bearer $TOKEN_MEDICO"

  paso "curl \"$URL/api/pacientes?q=<script>alert(1)</script>\"    # XSS: bloqueado por el WAF"
  curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$URL/api/pacientes?q=%3Cscript%3Ealert(1)%3C/script%3E" -H "Authorization: Bearer $TOKEN_MEDICO"

  paso "curl --max-time 8 http://$ALB/health    # acceso directo al ALB, saltándose CloudFront"
  r=$(curl -s --max-time 8 -o /dev/null -w '%{http_code}' "http://$ALB/health" || true)
  if [[ "$r" == "000" ]]; then echo "Sin respuesta (tiempo agotado): el grupo de seguridad solo admite IPs de origen de CloudFront"; else echo "HTTP $r"; fi

  paso "curl https://$BUCKET.s3.amazonaws.com/    # bucket de documentos sin acceso público"
  curl -s "https://$BUCKET.s3.amazonaws.com/" | grep -oE '<Code>[^<]+</Code>' | head -1

  paso "aws s3api get-public-access-block --bucket $BUCKET"
  aws s3api get-public-access-block --bucket "$BUCKET" --output json | jq -c .PublicAccessBlockConfiguration

  paso "aws s3api get-bucket-encryption --bucket $BUCKET"
  aws s3api get-bucket-encryption --bucket "$BUCKET" --query 'ServerSideEncryptionConfiguration.Rules[0]' --output json | jq -c .

  paso "aws rds describe-db-instances  # cifrado, acceso público, subred privada"
  aws rds describe-db-instances --db-instance-identifier siho-lite-db \
    --query 'DBInstances[0].{cifrada:StorageEncrypted,publica:PubliclyAccessible,motor:EngineVersion,clase:DBInstanceClass,respaldos_dias:BackupRetentionPeriod,multiAZ:MultiAZ}' --output json | jq -c .

  paso "aws rds describe-db-parameters  # TLS obligatorio"
  aws rds describe-db-parameters --db-parameter-group-name siho-lite-pg16 --query "Parameters[?ParameterName=='rds.force_ssl'].[ParameterName,ParameterValue]" --output text

  paso "aws cognito-idp describe-user-pool  # MFA y política de contraseñas"
  aws cognito-idp describe-user-pool --user-pool-id "$(terraform -chdir=infra output -raw user_pool_id)" \
    --query 'UserPool.{MFA:MfaConfiguration,longitud_minima:Policies.PasswordPolicy.MinimumLength,solo_admin_crea_usuarios:AdminCreateUserConfig.AllowAdminCreateUserOnly}' --output json | jq -c .
} 2>&1 | tee "$SALIDA"
