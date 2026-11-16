# Datos: RDS PostgreSQL 16 cifrada en subred privada, secretos y buckets S3.

# --- Secretos ---------------------------------------------------------------
resource "random_password" "db_app" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "db_app" {
  name                    = "${local.nombre}/db-app-${random_id.sufijo.hex}"
  description             = "Credenciales del rol de la aplicacion (siho_app) en PostgreSQL"
  recovery_window_in_days = 0 # el prototipo se destruye sin ventana de recuperación
}

resource "aws_secretsmanager_secret_version" "db_app" {
  secret_id     = aws_secretsmanager_secret.db_app.id
  secret_string = jsonencode({ username = "siho_app", password = random_password.db_app.result })
}

# Cabecera secreta que CloudFront agrega y el ALB exige: nadie puede saltarse CloudFront y el WAF.
resource "random_password" "origen" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "origen" {
  name                    = "${local.nombre}/x-origin-verify-${random_id.sufijo.hex}"
  description             = "Valor de la cabecera X-Origin-Verify entre CloudFront y el ALB"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "origen" {
  secret_id     = aws_secretsmanager_secret.origen.id
  secret_string = random_password.origen.result
}

# --- RDS --------------------------------------------------------------------
resource "aws_db_subnet_group" "principal" {
  name       = "${local.nombre}-db"
  subnet_ids = aws_subnet.privada[*].id
}

resource "aws_db_parameter_group" "pg16" {
  name   = "${local.nombre}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_connections"
    value = "1"
  }
}

resource "aws_db_instance" "principal" {
  identifier     = "${local.nombre}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true # llave administrada aws/rds (KMS)

  db_name                     = "siho"
  username                    = "siho_admin"
  manage_master_user_password = true # contraseña generada y rotable en Secrets Manager

  db_subnet_group_name   = aws_db_subnet_group.principal.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.pg16.name
  publicly_accessible    = false
  multi_az               = false # en producción sería Multi-AZ (Actividad 4); Single-AZ por costo

  backup_retention_period    = 7
  backup_window              = "07:00-07:30" # 2:00 a. m. Colombia
  maintenance_window         = "sun:08:00-sun:08:30"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true

  deletion_protection = false
  skip_final_snapshot = true
  apply_immediately   = true
}

# --- S3: documentos clínicos ------------------------------------------------
resource "aws_s3_bucket" "documentos" {
  bucket        = "${local.nombre}-documentos-${local.cuenta}"
  force_destroy = true # prototipo con datos sintéticos
}

resource "aws_s3_bucket_public_access_block" "documentos" {
  bucket                  = aws_s3_bucket.documentos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "documentos" {
  bucket = aws_s3_bucket.documentos.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documentos" {
  bucket = aws_s3_bucket.documentos.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "aws:kms" } # llave aws/s3
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_ownership_controls" "documentos" {
  bucket = aws_s3_bucket.documentos.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_lifecycle_configuration" "documentos" {
  bucket = aws_s3_bucket.documentos.id
  rule {
    id     = "glacier-ir-a-30-dias"
    status = "Enabled"
    filter {}
    transition {
      days          = 30
      storage_class = "GLACIER_IR"
    }
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
}

# Política que niega cualquier acceso sin TLS.
resource "aws_s3_bucket_policy" "documentos" {
  bucket     = aws_s3_bucket.documentos.id
  depends_on = [aws_s3_bucket_public_access_block.documentos]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "SoloTLS"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.documentos.arn, "${aws_s3_bucket.documentos.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# El navegador sube y descarga con URL prefirmadas desde el dominio de CloudFront.
resource "aws_s3_bucket_cors_configuration" "documentos" {
  bucket = aws_s3_bucket.documentos.id
  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = ["https://${aws_cloudfront_distribution.principal.domain_name}"]
    allowed_headers = ["content-type", "x-amz-checksum-sha256"]
    max_age_seconds = 300
  }
}

# --- S3: frontend (privado, solo CloudFront con OAC) -----------------------
resource "aws_s3_bucket" "frontend" {
  bucket        = "${local.nombre}-frontend-${local.cuenta}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket     = aws_s3_bucket.frontend.id
  depends_on = [aws_s3_bucket_public_access_block.frontend]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "SoloCloudFront"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.frontend.arn}/*"
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.principal.arn } }
      },
      {
        Sid       = "SoloTLS"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.frontend.arn, "${aws_s3_bucket.frontend.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })
}

# Configuración del frontend en tiempo de ejecución (no contiene secretos).
resource "aws_s3_object" "config_frontend" {
  bucket        = aws_s3_bucket.frontend.id
  key           = "config.json"
  content_type  = "application/json"
  cache_control = "no-store"
  content = jsonencode({
    authMode      = "cognito"
    cognitoDomain = "${aws_cognito_user_pool_domain.principal.domain}.auth.${var.region}.amazoncognito.com"
    clientId      = aws_cognito_user_pool_client.web.id
    ambiente      = "aws"
  })
}
