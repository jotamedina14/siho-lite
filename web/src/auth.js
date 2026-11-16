// Sesión: en AWS se usa el managed login de Amazon Cognito con código de autorización + PKCE
// (sin secretos en el navegador). En local, modo "dev" con tokens de prueba emitidos por la API.

const CLAVE = 'siho.sesion';
let config = null;

export async function cargarConfig() {
  const res = await fetch('/config.json', { cache: 'no-store' });
  config = await res.json();
  return config;
}

export const obtenerConfig = () => config;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const aleatorio = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

function decodificar(token) {
  const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(escape(atob(payload))));
}

function guardar(idToken) {
  const c = decodificar(idToken);
  const sesion = { idToken, email: c.email ?? c['cognito:username'] ?? c.sub, grupos: c['cognito:groups'] ?? [], expira: c.exp * 1000 };
  sessionStorage.setItem(CLAVE, JSON.stringify(sesion));
  return sesion;
}

export function sesionActual() {
  try {
    const s = JSON.parse(sessionStorage.getItem(CLAVE));
    if (s && s.expira > Date.now() + 30_000) return s;
  } catch { /* sesión inválida */ }
  sessionStorage.removeItem(CLAVE);
  return null;
}

const redirectUri = () => `${window.location.origin}/callback`;

export async function iniciarSesion(rolDev) {
  if (config.authMode === 'dev') {
    const res = await fetch('/dev/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rol: rolDev }) });
    if (!res.ok) throw new Error('No se pudo obtener token de desarrollo');
    return guardar((await res.json()).token);
  }
  const verifier = aleatorio(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = aleatorio(16);
  sessionStorage.setItem('siho.pkce', JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    response_type: 'code', client_id: config.clientId, redirect_uri: redirectUri(),
    scope: 'openid email profile', code_challenge_method: 'S256', code_challenge: challenge, state,
  });
  window.location.assign(`https://${config.cognitoDomain}/oauth2/authorize?${params}`);
  return null;
}

// Intercambia el código de autorización por tokens al volver de Cognito.
export async function completarCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const pkce = JSON.parse(sessionStorage.getItem('siho.pkce') ?? 'null');
  sessionStorage.removeItem('siho.pkce');
  window.history.replaceState({}, '', '/');
  if (!code || !pkce || url.searchParams.get('state') !== pkce.state) throw new Error('Respuesta de inicio de sesión inválida');
  const res = await fetch(`https://${config.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, code, redirect_uri: redirectUri(), code_verifier: pkce.verifier }),
  });
  if (!res.ok) throw new Error('No se pudo completar el inicio de sesión');
  return guardar((await res.json()).id_token);
}

export function cerrarSesion() {
  sessionStorage.removeItem(CLAVE);
  if (config?.authMode === 'cognito') {
    const params = new URLSearchParams({ client_id: config.clientId, logout_uri: `${window.location.origin}/` });
    window.location.assign(`https://${config.cognitoDomain}/logout?${params}`);
  } else {
    window.location.assign('/');
  }
}
