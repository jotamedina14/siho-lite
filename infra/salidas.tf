output "url_app" {
  description = "URL pública de la aplicación (HTTPS por CloudFront)"
  value       = "https://${aws_cloudfront_distribution.principal.domain_name}"
}

output "distribucion_id" { value = aws_cloudfront_distribution.principal.id }
output "alb_dns" { value = aws_lb.principal.dns_name }
output "ecr_url" { value = aws_ecr_repository.api.repository_url }
output "cluster" { value = aws_ecs_cluster.principal.name }
output "servicio" { value = aws_ecs_service.api.name }
output "familia_api" { value = aws_ecs_task_definition.api.family }
output "familia_migraciones" { value = aws_ecs_task_definition.migraciones.family }
output "subredes_publicas" { value = aws_subnet.publica[*].id }
output "sg_tareas" { value = aws_security_group.tareas.id }
output "bucket_frontend" { value = aws_s3_bucket.frontend.id }
output "bucket_documentos" { value = aws_s3_bucket.documentos.id }
output "rds_endpoint" { value = aws_db_instance.principal.address }
output "user_pool_id" { value = aws_cognito_user_pool.principal.id }
output "cliente_web_id" { value = aws_cognito_user_pool_client.web.id }
output "cliente_pruebas_id" { value = aws_cognito_user_pool_client.pruebas.id }
output "cognito_dominio" { value = "${aws_cognito_user_pool_domain.principal.domain}.auth.${var.region}.amazoncognito.com" }
output "waf_nombre" { value = aws_wafv2_web_acl.principal.name }
output "alb_arn_suffix" { value = aws_lb.principal.arn_suffix }
output "tg_arn_suffix" { value = aws_lb_target_group.api.arn_suffix }
