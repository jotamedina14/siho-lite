// Autenticación con JWT de Amazon Cognito (aws-jwt-verify valida firma, issuer, audiencia y expiración).
// Modo "dev" (solo desarrollo local y pruebas): tokens HS256 firmados con DEV_JWT_SECRET.
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { jwtVerify, SignJWT } from 'jose';
import { HttpError } from './errors.js';

export const ROLES = ['admin', 'admisiones', 'medico'];
const EMISOR_DEV = 'siho-lite-dev';

export function createAuth(authConfig) {
  let verificar;
  let hydrate = async () => {};

  if (authConfig.mode === 'dev') {
    const llave = new TextEncoder().encode(authConfig.devSecret);
    verificar = async (token) => (await jwtVerify(token, llave, { issuer: EMISOR_DEV, algorithms: ['HS256'] })).payload;
  } else {
    // Token de identidad (id token): trae email y grupos, y su audiencia es el app client.
    const verifier = CognitoJwtVerifier.create({
      userPoolId: authConfig.userPoolId,
      tokenUse: 'id',
      clientId: authConfig.clientIds,
    });
    verificar = (token) => verifier.verify(token);
    hydrate = () => verifier.hydrate(); // descarga las llaves públicas (JWKS) al arrancar
  }

  async function authenticate(req, _res, next) {
    const [esquema, token] = (req.get('authorization') ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) return next(new HttpError(401, 'no_autenticado'));
    try {
      const claims = await verificar(token);
      const grupos = (claims['cognito:groups'] ?? []).filter((g) => ROLES.includes(g));
      req.user = { sub: claims.sub, email: claims.email ?? claims['cognito:username'] ?? null, grupos };
      return next();
    } catch {
      return next(new HttpError(401, 'token_invalido'));
    }
  }

  return { authenticate, hydrate };
}

// Autoriza si el usuario pertenece a alguno de los grupos indicados.
export const requireRole = (...roles) => (req, _res, next) =>
  req.user?.grupos.some((g) => roles.includes(g)) ? next() : next(new HttpError(403, 'prohibido'));

export const TODOS = ROLES;

// Firma un token de desarrollo (pruebas automáticas y login local sin Cognito).
export async function firmarTokenDev(secreto, { sub, email, grupos, expira = '8h' }) {
  return new SignJWT({ email, 'cognito:groups': grupos })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(EMISOR_DEV)
    .setIssuedAt()
    .setExpirationTime(expira)
    .sign(new TextEncoder().encode(secreto));
}
