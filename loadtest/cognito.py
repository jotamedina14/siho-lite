"""Usuarios de prueba en Amazon Cognito (con MFA TOTP) y obtención de tokens por API.

El grupo de usuarios exige MFA a todos. Para las pruebas automáticas se crean usuarios sintéticos
cuyo secreto TOTP se guarda en loadtest/.secrets.json (no versionado), y los códigos se generan con pyotp.

    python loadtest/cognito.py crear      # crea/actualiza los usuarios de prueba
    python loadtest/cognito.py tokens     # escribe loadtest/.secrets-tokens.json para las capturas
"""

import json
import secrets
import string
import subprocess
import sys
import time
from pathlib import Path

import boto3
import pyotp

AQUI = Path(__file__).resolve().parent
SECRETOS = AQUI / ".secrets.json"
TOKENS = AQUI / ".secrets-tokens.json"
DOMINIO = "siho-lite.example"  # dominio reservado: nunca recibe correo real

USUARIOS = {
    "carga": ["admin", "admisiones"],  # usuario de Locust: puede buscar, crear y ver reportes
    "admisiones": ["admisiones"],
    "medico": ["medico"],
    "admin": ["admin"],
}


def salida_tf(nombre: str) -> str:
    return subprocess.check_output(["terraform", f"-chdir={AQUI.parent / 'infra'}", "output", "-raw", nombre], text=True)


def cliente():
    return boto3.Session(profile_name="siho", region_name="us-east-1").client("cognito-idp")


def contrasena() -> str:
    base = [secrets.choice(string.ascii_uppercase), secrets.choice(string.ascii_lowercase), secrets.choice(string.digits), secrets.choice("!@#%^*-_=+")]
    resto = [secrets.choice(string.ascii_letters + string.digits) for _ in range(20)]
    lista = base + resto
    secrets.SystemRandom().shuffle(lista)
    return "".join(lista)


def crear():
    idp, pool, app = cliente(), salida_tf("user_pool_id"), salida_tf("cliente_pruebas_id")
    datos = json.loads(SECRETOS.read_text()) if SECRETOS.exists() else {}
    for nombre, grupos in USUARIOS.items():
        if nombre in datos and datos[nombre].get("pool") == pool:
            print(f"  {nombre}: ya existe")
            continue
        email, clave = f"{nombre}@{DOMINIO}", contrasena()
        try:
            idp.admin_create_user(UserPoolId=pool, Username=email, MessageAction="SUPPRESS",
                                  UserAttributes=[{"Name": "email", "Value": email}, {"Name": "email_verified", "Value": "true"}])
        except idp.exceptions.UsernameExistsException:
            pass
        idp.admin_set_user_password(UserPoolId=pool, Username=email, Password=clave, Permanent=True)
        for g in grupos:
            idp.admin_add_user_to_group(UserPoolId=pool, Username=email, GroupName=g)
        # Primer inicio de sesión: Cognito exige configurar el TOTP (MFA_SETUP).
        r = idp.initiate_auth(ClientId=app, AuthFlow="USER_PASSWORD_AUTH", AuthParameters={"USERNAME": email, "PASSWORD": clave})
        assert r.get("ChallengeName") == "MFA_SETUP", r.get("ChallengeName")
        asoc = idp.associate_software_token(Session=r["Session"])
        totp = asoc["SecretCode"]
        ver = idp.verify_software_token(Session=asoc["Session"], UserCode=pyotp.TOTP(totp).now(), FriendlyDeviceName="pruebas")
        idp.respond_to_auth_challenge(ClientId=app, ChallengeName="MFA_SETUP", Session=ver["Session"], ChallengeResponses={"USERNAME": email})
        idp.admin_set_user_mfa_preference(UserPoolId=pool, Username=email, SoftwareTokenMfaSettings={"Enabled": True, "PreferredMfa": True})
        datos[nombre] = {"email": email, "password": clave, "totp": totp, "grupos": grupos, "pool": pool}
        SECRETOS.write_text(json.dumps(datos, indent=2))
        SECRETOS.chmod(0o600)
        print(f"  {nombre}: creado con MFA ({', '.join(grupos)})")
        time.sleep(1)


def obtener_token(nombre: str) -> dict:
    """Inicia sesión con usuario, contraseña y código TOTP; devuelve la sesión con el id token."""
    datos = json.loads(SECRETOS.read_text())[nombre]
    idp, app = cliente(), salida_tf("cliente_pruebas_id")
    for intento in range(3):
        r = idp.initiate_auth(ClientId=app, AuthFlow="USER_PASSWORD_AUTH", AuthParameters={"USERNAME": datos["email"], "PASSWORD": datos["password"]})
        try:
            t = idp.respond_to_auth_challenge(ClientId=app, ChallengeName="SOFTWARE_TOKEN_MFA", Session=r["Session"],
                                              ChallengeResponses={"USERNAME": datos["email"], "SOFTWARE_TOKEN_MFA_CODE": pyotp.TOTP(datos["totp"]).now()})
            id_token = t["AuthenticationResult"]["IdToken"]
            break
        except idp.exceptions.CodeMismatchException:
            # Cognito no acepta el mismo código dos veces: se espera la siguiente ventana de 30 s.
            time.sleep(31 - time.time() % 30)
    else:
        raise RuntimeError(f"No se pudo iniciar sesión con {nombre}")
    expira = int(time.time() + t["AuthenticationResult"]["ExpiresIn"]) * 1000
    return {"idToken": id_token, "email": datos["email"], "grupos": datos["grupos"], "expira": expira}


def tokens():
    sesiones = {n: obtener_token(n) for n in ("admisiones", "medico", "admin")}
    TOKENS.write_text(json.dumps(sesiones))
    TOKENS.chmod(0o600)
    print(f"  tokens escritos en {TOKENS} (válidos 3 horas)")


if __name__ == "__main__":
    {"crear": crear, "tokens": tokens}[sys.argv[1]]()
