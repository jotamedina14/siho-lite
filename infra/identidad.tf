# Identidad: Amazon Cognito con grupos por rol y MFA TOTP obligatoria.
# Se exige MFA a todos los usuarios (más estricto que "solo admin" del diseño): Cognito no permite
# exigirla por grupo y así ningún usuario entra solo con contraseña.

resource "aws_cognito_user_pool" "principal" {
  name                = "${local.nombre}-usuarios"
  user_pool_tier      = "ESSENTIALS"
  deletion_protection = "INACTIVE"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  mfa_configuration = "ON"
  software_token_mfa_configuration { enabled = true }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 3
  }

  admin_create_user_config { allow_admin_create_user_only = true } # sin auto-registro

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_group" "roles" {
  for_each     = toset(["admin", "admisiones", "medico"])
  name         = each.key
  user_pool_id = aws_cognito_user_pool.principal.id
  description  = "Rol ${each.key} de SIHO Lite"
}

resource "aws_cognito_user_pool_domain" "principal" {
  domain                = "${local.nombre}-${random_id.sufijo.hex}"
  user_pool_id          = aws_cognito_user_pool.principal.id
  managed_login_version = 2
}

# Cliente del frontend: código de autorización + PKCE, sin secreto (aplicación pública).
resource "aws_cognito_user_pool_client" "web" {
  name                                 = "${local.nombre}-web"
  user_pool_id                         = aws_cognito_user_pool.principal.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${aws_cloudfront_distribution.principal.domain_name}/callback", "http://localhost:5173/callback"]
  logout_urls                          = ["https://${aws_cloudfront_distribution.principal.domain_name}/", "http://localhost:5173/"]
  explicit_auth_flows                  = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  id_token_validity                    = 60
  access_token_validity                = 60
  refresh_token_validity               = 1
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}

# Cliente para las pruebas automáticas (Locust y capturas): usuario y contraseña + TOTP por API.
resource "aws_cognito_user_pool_client" "pruebas" {
  name                          = "${local.nombre}-pruebas-carga"
  user_pool_id                  = aws_cognito_user_pool.principal.id
  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  id_token_validity             = 3
  access_token_validity         = 3
  refresh_token_validity        = 1
  token_validity_units {
    id_token      = "hours"
    access_token  = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_managed_login_branding" "web" {
  user_pool_id                = aws_cognito_user_pool.principal.id
  client_id                   = aws_cognito_user_pool_client.web.id
  use_cognito_provided_values = true
}
