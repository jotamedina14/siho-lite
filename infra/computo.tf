# Cómputo: ECR, ECS Fargate (2 a 6 tareas en 2 AZ), ALB con least outstanding requests y autoescalado.

resource "aws_ecr_repository" "api" {
  name                 = "${local.nombre}-api"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Conservar solo las 10 imagenes mas recientes"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.nombre}-api"
  retention_in_days = 30
}

# --- IAM: roles separados (mínimo privilegio) -------------------------------
data "aws_iam_policy_document" "asumir_ecs" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.cuenta]
    }
  }
}

# Rol de ejecución: lo usa ECS para descargar la imagen, escribir logs e inyectar secretos.
resource "aws_iam_role" "ejecucion" {
  name               = "${local.nombre}-ejecucion-tarea"
  assume_role_policy = data.aws_iam_policy_document.asumir_ecs.json
}

resource "aws_iam_role_policy_attachment" "ejecucion_base" {
  role       = aws_iam_role.ejecucion.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ejecucion_secretos" {
  name = "leer-secretos-db"
  role = aws_iam_role.ejecucion.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = [aws_secretsmanager_secret.db_app.arn, aws_db_instance.principal.master_user_secret[0].secret_arn]
    }]
  })
}

# Rol de la tarea (la API en ejecución): solo puede leer y escribir objetos del bucket de documentos.
resource "aws_iam_role" "tarea_api" {
  name               = "${local.nombre}-tarea-api"
  assume_role_policy = data.aws_iam_policy_document.asumir_ecs.json
}

resource "aws_iam_role_policy" "tarea_api_s3" {
  name = "documentos-clinicos"
  role = aws_iam_role.tarea_api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:GetObject"]
      Resource = "${aws_s3_bucket.documentos.arn}/pacientes/*"
    }]
  })
}

# --- ECS ----------------------------------------------------------------------
resource "aws_ecs_cluster" "principal" {
  name = local.nombre
  setting {
    name  = "containerInsights"
    value = "disabled" # se evita su costo; las tareas sanas se miden con HealthyHostCount del ALB
  }
}

locals {
  imagen = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
  entorno_db = [
    { name = "NODE_ENV", value = "production" },
    { name = "DB_HOST", value = aws_db_instance.principal.address },
    { name = "DB_PORT", value = tostring(aws_db_instance.principal.port) },
    { name = "DB_NAME", value = aws_db_instance.principal.db_name },
    { name = "DB_USER", value = "siho_app" },
    { name = "DB_SSL", value = "true" },
  ]
  logs = {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.api.name
      awslogs-region        = var.region
      awslogs-stream-prefix = "api"
    }
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.nombre}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ejecucion.arn
  task_role_arn            = aws_iam_role.tarea_api.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = "api"
    image                  = local.imagen
    essential              = true
    readonlyRootFilesystem = true
    stopTimeout            = 30
    portMappings           = [{ containerPort = 3000, protocol = "tcp" }]
    environment = concat(local.entorno_db, [
      { name = "PORT", value = "3000" },
      { name = "TRUST_PROXY", value = "2" },
      { name = "AUTH_MODE", value = "cognito" },
      { name = "COGNITO_USER_POOL_ID", value = aws_cognito_user_pool.principal.id },
      { name = "COGNITO_CLIENT_IDS", value = "${aws_cognito_user_pool_client.web.id},${aws_cognito_user_pool_client.pruebas.id}" },
      { name = "CORS_ORIGINS", value = "https://${aws_cloudfront_distribution.principal.domain_name}" },
      { name = "DOCS_BUCKET", value = aws_s3_bucket.documentos.id },
      { name = "AWS_REGION", value = var.region },
      { name = "APP_VERSION", value = var.image_tag },
    ])
    secrets = [
      { name = "DB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.db_app.arn}:password::" },
    ]
    logConfiguration = local.logs
  }])
}

# Tarea de una sola ejecución: migraciones + seed. Es la única que recibe la credencial de administración.
resource "aws_ecs_task_definition" "migraciones" {
  family                   = "${local.nombre}-migraciones"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ejecucion.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = "migraciones"
    image                  = local.imagen
    essential              = true
    readonlyRootFilesystem = true
    command                = ["sh", "-c", "node src/db/migrate.js && node src/db/seed.js"]
    environment            = local.entorno_db
    secrets = [
      { name = "DB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.db_app.arn}:password::" },
      { name = "DB_ADMIN_USER", valueFrom = "${aws_db_instance.principal.master_user_secret[0].secret_arn}:username::" },
      { name = "DB_ADMIN_PASSWORD", valueFrom = "${aws_db_instance.principal.master_user_secret[0].secret_arn}:password::" },
    ]
    logConfiguration = local.logs
  }])
}

# --- ALB ----------------------------------------------------------------------
resource "aws_lb" "principal" {
  name                       = "${local.nombre}-alb"
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = aws_subnet.publica[*].id
  security_groups            = [aws_security_group.alb.id]
  idle_timeout               = 60
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "api" {
  name                          = "${local.nombre}-api"
  port                          = 3000
  protocol                      = "HTTP"
  target_type                   = "ip"
  vpc_id                        = aws_vpc.principal.id
  load_balancing_algorithm_type = "least_outstanding_requests" # balanceo dinámico según carga real
  deregistration_delay          = 30
  health_check {
    path                = "/health"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.principal.arn
  port              = 80
  protocol          = "HTTP"
  # Sin la cabecera secreta de CloudFront, la respuesta es 403.
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\":\"acceso_directo_no_permitido\"}"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "desde_cloudfront" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10
  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origen.result]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_ecs_service" "api" {
  name                              = "${local.nombre}-api"
  cluster                           = aws_ecs_cluster.principal.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = var.tareas_min
  launch_type                       = "FARGATE"
  platform_version                  = "LATEST"
  health_check_grace_period_seconds = 30
  propagate_tags                    = "SERVICE"
  enable_ecs_managed_tags           = true

  network_configuration {
    subnets          = aws_subnet.publica[*].id
    security_groups  = [aws_security_group.tareas.id]
    assign_public_ip = true # para llegar a ECR y Secrets Manager sin NAT Gateway
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # La imagen nueva la despliega scripts/deploy.sh y el número de tareas lo maneja el autoescalado.
  lifecycle { ignore_changes = [task_definition, desired_count] }
  depends_on = [aws_lb_listener_rule.desde_cloudfront]
}

# --- Autoescalado: nivel reactivo (target tracking) y predictivo (acción programada) ---
resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.principal.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.tareas_min
  max_capacity       = var.tareas_max
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${local.nombre}-cpu-${var.objetivo_cpu}"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value       = var.objetivo_cpu
    scale_out_cooldown = 60
    scale_in_cooldown  = 180
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
  }
}

resource "aws_appautoscaling_policy" "solicitudes" {
  name               = "${local.nombre}-solicitudes-por-tarea"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value       = var.objetivo_solicitudes_por_tarea
    scale_out_cooldown = 60
    scale_in_cooldown  = 180
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.principal.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
  }
}

# Pico de consulta externa (Actividad 4): a las 6:15 a. m. el mínimo sube a 3; a las 10:30 vuelve a 2.
resource "aws_appautoscaling_scheduled_action" "pico_matutino" {
  name               = "${local.nombre}-pico-matutino"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  schedule           = "cron(15 6 * * ? *)"
  timezone           = "America/Bogota"
  scalable_target_action {
    min_capacity = 3
    max_capacity = var.tareas_max
  }
}

resource "aws_appautoscaling_scheduled_action" "fin_pico" {
  name               = "${local.nombre}-fin-pico"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  schedule           = "cron(30 10 * * ? *)"
  timezone           = "America/Bogota"
  scalable_target_action {
    min_capacity = var.tareas_min
    max_capacity = var.tareas_max
  }
  depends_on = [aws_appautoscaling_scheduled_action.pico_matutino]
}
