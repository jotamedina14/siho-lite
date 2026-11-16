#!/usr/bin/env bash
# Despliegue de SIHO Lite en AWS (reemplaza a GitHub Actions en el modo de un solo día).
#
#   scripts/deploy.sh imagen   construye la imagen linux/amd64, la publica en ECR e imprime su etiqueta
#   scripts/deploy.sh migrar   ejecuta migraciones + seed como tarea única de ECS y espera el resultado
#   scripts/deploy.sh api      imagen nueva -> nuevas revisiones de tarea -> actualiza el servicio sin cortes
#   scripts/deploy.sh web      compila el frontend, lo sube a S3 e invalida la caché de CloudFront
#   scripts/deploy.sh todo     api + migrar + web
source "$(dirname "$0")/entorno_aws.sh"
cd "$RAIZ"

ETIQUETAS=(key=Proyecto,value=SIHO-Lite key=Ambiente,value=prototipo key=Responsable,value=yonathan-lopez key=Curso,value=ElectivaIII)
salida() { terraform -chdir=infra output -raw "$1"; }

construir_imagen() {
  local repo tag
  repo=$(aws ecr describe-repositories --repository-names siho-lite-api --query 'repositories[0].repositoryUri' --output text)
  tag="v$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo local)"
  aws ecr get-login-password | docker login --username AWS --password-stdin "${repo%%/*}" >/dev/null 2>&1
  docker build --platform linux/amd64 --build-arg APP_VERSION="$tag" -t "$repo:$tag" api >&2
  docker push -q "$repo:$tag" >&2
  echo "$tag"
}

# Registra una nueva revisión de la definición de tarea cambiando solo la imagen y APP_VERSION.
nueva_revision() {
  local familia=$1 tag=$2 repo td
  repo=$(aws ecr describe-repositories --repository-names siho-lite-api --query 'repositories[0].repositoryUri' --output text)
  td=$(aws ecs describe-task-definition --task-definition "$familia" --query taskDefinition --output json |
    jq --arg img "$repo:$tag" --arg tag "$tag" '
      .containerDefinitions[0].image = $img
      | .containerDefinitions[0].environment |= map(if .name == "APP_VERSION" then .value = $tag else . end)
      | {family, taskRoleArn, executionRoleArn, networkMode, containerDefinitions, requiresCompatibilities, cpu, memory, runtimePlatform}
      | with_entries(select(.value != null))')
  aws ecs register-task-definition --cli-input-json "$td" --tags "${ETIQUETAS[@]}" \
    --query 'taskDefinition.taskDefinitionArn' --output text
}

migrar() {
  local cluster subredes sg tarea codigo
  cluster=$(salida cluster)
  subredes=$(terraform -chdir=infra output -json subredes_publicas | jq -r 'join(",")')
  sg=$(salida sg_tareas)
  echo "Ejecutando migraciones + seed en ECS..."
  tarea=$(aws ecs run-task --cluster "$cluster" --task-definition "$(salida familia_migraciones)" --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$subredes],securityGroups=[$sg],assignPublicIp=ENABLED}" \
    --tags "${ETIQUETAS[@]}" --query 'tasks[0].taskArn' --output text)
  aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$tarea"
  codigo=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$tarea" --query 'tasks[0].containers[0].exitCode' --output text)
  aws logs tail /ecs/siho-lite-api --since 10m --format short 2>/dev/null | grep -E "migraci|seed|permisos" | tail -5 || true
  [[ "$codigo" == "0" ]] || { echo "La tarea de migraciones terminó con código $codigo" >&2; exit 1; }
  echo "Migraciones y seed: OK"
}

desplegar_api() {
  local tag td
  tag=$(construir_imagen)
  echo "Imagen publicada: $tag"
  nueva_revision "$(salida familia_migraciones)" "$tag" >/dev/null
  td=$(nueva_revision "$(salida familia_api)" "$tag")
  echo "Actualizando el servicio a $td ..."
  aws ecs update-service --cluster "$(salida cluster)" --service "$(salida servicio)" --task-definition "$td" >/dev/null
  aws ecs wait services-stable --cluster "$(salida cluster)" --services "$(salida servicio)"
  echo "Servicio estable con la versión $tag"
}

desplegar_web() {
  local bucket
  bucket=$(salida bucket_frontend)
  (cd web && npm ci --silent && npm run build --silent)
  # config.json lo administra Terraform (datos de Cognito); no se sobrescribe con el de desarrollo.
  aws s3 sync web/dist "s3://$bucket" --delete --exclude config.json --exclude index.html \
    --cache-control "public,max-age=31536000,immutable" --only-show-errors
  aws s3 cp web/dist/index.html "s3://$bucket/index.html" --cache-control "no-cache" --only-show-errors
  aws cloudfront create-invalidation --distribution-id "$(salida distribucion_id)" --paths "/*" \
    --query 'Invalidation.Id' --output text >/dev/null
  echo "Frontend publicado en $(salida url_app)"
}

case "${1:-}" in
  imagen) construir_imagen ;;
  migrar) migrar ;;
  api) desplegar_api ;;
  web) desplegar_web ;;
  todo) desplegar_api && migrar && desplegar_web ;;
  *) sed -n '2,9p' "$0"; exit 1 ;;
esac
