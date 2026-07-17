// Detecta navegadores in-app (LinkedIn, Instagram, Facebook, TikTok, etc.).
// Supabase/Google OAuth se bloquea dentro de estos webviews embebidos,
// así que conviene avisar al usuario que abra en Chrome/Safari en vez
// de dejarlo chocar contra el bloqueo.
export function isInAppBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const markers = [
    'FBAN', 'FBAV', 'FB_IAB', 'Instagram', 'LinkedInApp', 'Line/',
    'Twitter', 'Snapchat', 'Pinterest', 'TikTok', 'musical_ly',
    'WhatsApp', 'WeChat', 'MicroMessenger', 'GSA/', '; wv'
  ];
  return markers.some((m) => ua.includes(m));
}

// Heurística simple para detectar móviles
export function isMobile() {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

// Mapea errores de Supabase a mensajes localizados y accionables
export function friendlyAuthError(error, language = 'es') {
  if (!error) return language === 'es' ? 'Error de autenticación desconocido' : 'Unknown authentication error';

  const code = error.code || error.message || '';
  const msg = error.message || '';

  // Errores de Supabase Auth
  const errorMap = {
    es: {
      'invalid_credentials': 'Email o contraseña incorrecta. Verifica tus datos e intenta de nuevo.',
      'user_not_found': 'No encontramos una cuenta con ese email. Regístrate primero.',
      'email_not_confirmed': 'Tu email no ha sido confirmado. Revisa tu bandeja de entrada.',
      'invalid_grant': 'Tu sesión expiró. Inicia sesión nuevamente.',
      'oauth_provider_not_enabled': 'El proveedor OAuth no está habilitado en esta sala.',
      'user_already_exists': 'Ya existe una cuenta con ese email.',
      'weak_password': 'La contraseña es muy débil. Usa al menos 6 caracteres.',
      'network_error': 'Error de conexión. Verifica tu internet e intenta de nuevo.',
    },
    en: {
      'invalid_credentials': 'Incorrect email or password. Please check your details and try again.',
      'user_not_found': 'No account found with that email. Sign up first.',
      'email_not_confirmed': 'Your email has not been confirmed. Check your inbox.',
      'invalid_grant': 'Your session expired. Please sign in again.',
      'oauth_provider_not_enabled': 'OAuth provider is not enabled for this room.',
      'user_already_exists': 'An account with that email already exists.',
      'weak_password': 'Password is too weak. Use at least 6 characters.',
      'network_error': 'Connection error. Check your internet and try again.',
    }
  };

  const messages = errorMap[language] || errorMap['es'];

  // Buscar coincidencia exacta en el mapa
  if (code && messages[code]) return messages[code];

  // Búsqueda parcial en el mensaje
  for (const [key, template] of Object.entries(messages)) {
    if (msg.toLowerCase().includes(key.toLowerCase())) {
      return template;
    }
  }

  // Fallback: devolver mensaje original si es legible
  if (msg && msg.length < 200 && !msg.includes('error(')) {
    return msg;
  }

  // Último recurso: mensaje genérico
  return language === 'es'
    ? 'Error al iniciar sesión. Intenta de nuevo en unos momentos.'
    : 'Error signing in. Please try again in a moment.';
}
