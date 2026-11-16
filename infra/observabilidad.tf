# Observabilidad: alarmas con notificación por correo y dashboard para las pruebas.

resource "aws_sns_topic" "alarmas" {
  name = "${local.nombre}-alarmas"
}

resource "aws_sns_topic_subscription" "correo" {
  topic_arn = aws_sns_topic.alarmas.arn
  protocol  = "email"
  endpoint  = var.correo_alertas
}

locals {
  dim_alb  = { LoadBalancer = aws_lb.principal.arn_suffix }
  dim_tg   = { LoadBalancer = aws_lb.principal.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
  dim_ecs  = { ClusterName = aws_ecs_cluster.principal.name, ServiceName = aws_ecs_service.api.name }
  acciones = [aws_sns_topic.alarmas.arn]
}

resource "aws_cloudwatch_metric_alarm" "errores_5xx" {
  alarm_name          = "${local.nombre}-errores-5xx"
  alarm_description   = "La API devolvió más de 10 errores 5xx por minuto"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = local.dim_tg
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.acciones
  ok_actions          = local.acciones
}

resource "aws_cloudwatch_metric_alarm" "latencia_p95" {
  alarm_name          = "${local.nombre}-latencia-p95"
  alarm_description   = "La latencia p95 de la API superó 1 segundo"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = local.dim_tg
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.acciones
  ok_actions          = local.acciones
}

resource "aws_cloudwatch_metric_alarm" "cpu_alta" {
  alarm_name          = "${local.nombre}-cpu-alta"
  alarm_description   = "CPU promedio del servicio mayor a 80 % (debería estar escalando)"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = local.dim_ecs
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.acciones
  ok_actions          = local.acciones
}

resource "aws_cloudwatch_metric_alarm" "tareas_sanas" {
  alarm_name          = "${local.nombre}-tareas-sanas"
  alarm_description   = "Menos de 2 tareas sanas detrás del ALB"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = local.dim_tg
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 2
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.acciones
  ok_actions          = local.acciones
}

resource "aws_cloudwatch_dashboard" "principal" {
  dashboard_name = local.nombre
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title   = "Solicitudes por minuto (ALB)", region = var.region, stat = "Sum", period = 60, view = "timeSeries"
          metrics = [["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.principal.arn_suffix]]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title = "Latencia de la API (s)", region = var.region, period = 60, view = "timeSeries"
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.principal.arn_suffix, "TargetGroup", aws_lb_target_group.api.arn_suffix, { stat = "p50", label = "p50" }],
            ["...", { stat = "p95", label = "p95" }],
            ["...", { stat = "p99", label = "p99" }],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 6, width = 8, height = 6
        properties = {
          title   = "Tareas sanas detrás del ALB", region = var.region, period = 60, view = "timeSeries", stat = "Maximum"
          metrics = [["AWS/ApplicationELB", "HealthyHostCount", "LoadBalancer", aws_lb.principal.arn_suffix, "TargetGroup", aws_lb_target_group.api.arn_suffix]]
          yAxis   = { left = { min = 0, max = var.tareas_max + 1 } }
        }
      },
      {
        type = "metric", x = 8, y = 6, width = 8, height = 6
        properties = {
          title = "CPU y memoria del servicio ECS (%)", region = var.region, period = 60, view = "timeSeries", stat = "Average"
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.principal.name, "ServiceName", aws_ecs_service.api.name],
            [".", "MemoryUtilization", ".", ".", ".", "."],
          ]
        }
      },
      {
        type = "metric", x = 16, y = 6, width = 8, height = 6
        properties = {
          title = "Errores HTTP", region = var.region, period = 60, view = "timeSeries", stat = "Sum"
          metrics = [
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", aws_lb.principal.arn_suffix, "TargetGroup", aws_lb_target_group.api.arn_suffix],
            [".", "HTTPCode_Target_4XX_Count", ".", ".", ".", "."],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 12, width = 12, height = 6
        properties = {
          title   = "WAF: solicitudes bloqueadas", region = "us-east-1", period = 300, view = "timeSeries", stat = "Sum"
          metrics = [["AWS/WAFV2", "BlockedRequests", "WebACL", aws_wafv2_web_acl.principal.name, "Rule", "ALL"]]
        }
      },
      {
        type = "metric", x = 12, y = 12, width = 12, height = 6
        properties = {
          title = "RDS: CPU (%) y conexiones", region = var.region, period = 60, view = "timeSeries", stat = "Average"
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.principal.identifier],
            [".", "DatabaseConnections", ".", ".", { yAxis = "right" }],
          ]
        }
      },
    ]
  })
}
