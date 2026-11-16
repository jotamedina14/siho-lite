# Borde: CloudFront (HTTPS sin comprar dominio) + AWS WAF.

# --- WAF ----------------------------------------------------------------------
resource "aws_wafv2_ip_set" "prueba_carga" {
  name               = "${local.nombre}-ips-prueba-carga"
  scope              = "CLOUDFRONT"
  ip_address_version = "IPV4"
  addresses          = var.ips_prueba_carga
}

resource "aws_wafv2_web_acl" "principal" {
  name  = "${local.nombre}-waf"
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  dynamic "rule" {
    for_each = {
      AWSManagedRulesCommonRuleSet         = 1
      AWSManagedRulesKnownBadInputsRuleSet = 2
      AWSManagedRulesSQLiRuleSet           = 3
    }
    content {
      name     = rule.key
      priority = rule.value
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.key
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  # Límite de tasa por IP: 1.000 solicitudes en 5 minutos. Se excluye la IP de la prueba de carga.
  rule {
    name     = "LimiteDeTasaPorIP"
    priority = 4
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = 1000
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
        scope_down_statement {
          not_statement {
            statement {
              ip_set_reference_statement { arn = aws_wafv2_ip_set.prueba_carga.arn }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "LimiteDeTasaPorIP"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.nombre}-waf"
    sampled_requests_enabled   = true
  }
}

# --- CloudFront -----------------------------------------------------------------
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.nombre}-frontend-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# SPA: cualquier ruta sin extensión (p. ej. /callback) se sirve con index.html.
resource "aws_cloudfront_function" "spa" {
  name    = "${local.nombre}-spa"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var req = event.request;
      if (req.uri.indexOf('.') === -1) { req.uri = '/index.html'; }
      return req;
    }
  JS
}

locals {
  # Políticas administradas de CloudFront
  cache_optimizada       = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
  cache_deshabilitada    = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
  origen_todo_menos_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader
  cabeceras_seguridad    = "67f7725c-6f97-4210-82d7-5512b31e9d03" # Managed-SecurityHeadersPolicy
}

resource "aws_cloudfront_distribution" "principal" {
  enabled             = true
  comment             = "SIHO Lite"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"
  web_acl_id          = aws_wafv2_web_acl.principal.arn

  origin {
    origin_id                = "frontend"
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  origin {
    origin_id   = "api"
    domain_name = aws_lb.principal.dns_name
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only" # sin dominio propio no hay certificado para el ALB
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 30
    }
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origen.result
    }
  }

  default_cache_behavior {
    target_origin_id           = "frontend"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_optimizada
    response_headers_policy_id = local.cabeceras_seguridad
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = ["/api/*", "/health"]
    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = "api"
      viewer_protocol_policy     = "redirect-to-https"
      allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = true
      cache_policy_id            = local.cache_deshabilitada
      origin_request_policy_id   = local.origen_todo_menos_host
      response_headers_policy_id = local.cabeceras_seguridad
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/config.json"
    target_origin_id           = "frontend"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.cache_deshabilitada
    response_headers_policy_id = local.cabeceras_seguridad
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
