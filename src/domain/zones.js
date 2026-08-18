// Países, zonas horarias y días de la semana.
//
// Es la tabla de referencia con la que la app traduce el país que elige cada
// persona a una zona IANA, y con la que adivina el país a partir del navegador
// para poder registrar a alguien sin pedirle que lo elija a mano.

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Paises y Zonas Horarias
export const ZONAS = [
  // América
  { country: 'Argentina', tz: 'America/Argentina/Buenos_Aires', flag: '🇦🇷' },
  { country: 'Chile', tz: 'America/Santiago', flag: '🇨🇱' },
  { country: 'Colombia', tz: 'America/Bogota', flag: '🇨🇴' },
  { country: 'México', tz: 'America/Mexico_City', flag: '🇲🇽' },
  { country: 'Estados Unidos (Este)', tz: 'America/New_York', flag: '🇺🇸' },
  { country: 'Estados Unidos (Pacífico)', tz: 'America/Los_Angeles', flag: '🇺🇸' },
  { country: 'Perú', tz: 'America/Lima', flag: '🇵🇪' },
  { country: 'Uruguay', tz: 'America/Montevideo', flag: '🇺🇾' },
  { country: 'Ecuador', tz: 'America/Guayaquil', flag: '🇪🇨' },
  { country: 'Paraguay', tz: 'America/Asuncion', flag: '🇵🇾' },
  { country: 'Bolivia', tz: 'America/La_Paz', flag: '🇧🇴' },
  { country: 'Costa Rica', tz: 'America/Costa_Rica', flag: '🇨🇷' },
  { country: 'Panamá', tz: 'America/Panama', flag: '🇵🇦' },
  { country: 'Venezuela', tz: 'America/Caracas', flag: '🇻🇪' },

  // Europa Central / Occidental
  { country: 'España', tz: 'Europe/Madrid', flag: '🇪🇸' },
  { country: 'Alemania', tz: 'Europe/Berlin', flag: '🇩🇪' },
  { country: 'Francia', tz: 'Europe/Paris', flag: '🇫🇷' },
  { country: 'Italia', tz: 'Europe/Rome', flag: '🇮🇹' },
  { country: 'Reino Unido', tz: 'Europe/London', flag: '🇬🇧' },
  { country: 'Suiza', tz: 'Europe/Zurich', flag: '🇨🇭' },
  { country: 'Austria', tz: 'Europe/Vienna', flag: '🇦🇹' },
  { country: 'Polonia', tz: 'Europe/Warsaw', flag: '🇵🇱' },
  { country: 'Países Bajos', tz: 'Europe/Amsterdam', flag: '🇳🇱' },
  { country: 'Bélgica', tz: 'Europe/Brussels', flag: '🇧🇪' },
  { country: 'República Checa', tz: 'Europe/Prague', flag: '🇨🇿' },
  { country: 'Portugal', tz: 'Europe/Lisbon', flag: '🇵🇹' },

  // Brasil faltaba, siendo el país más grande de la región. Quien entraba desde
  // ahí quedaba registrado con horario de Buenos Aires y recibía propuestas
  // corridas una hora, sin ninguna pantalla donde corregirlo.
  { country: 'Brasil', tz: 'America/Sao_Paulo', flag: '🇧🇷' },
  { country: 'Guatemala', tz: 'America/Guatemala', flag: '🇬🇹' },
  { country: 'Rep. Dominicana', tz: 'America/Santo_Domingo', flag: '🇩🇴' },
  { country: 'Honduras', tz: 'America/Tegucigalpa', flag: '🇭🇳' },
  { country: 'El Salvador', tz: 'America/El_Salvador', flag: '🇸🇻' },
  { country: 'Nicaragua', tz: 'America/Managua', flag: '🇳🇮' },
  { country: 'Cuba', tz: 'America/Havana', flag: '🇨🇺' },
  { country: 'Canadá (Este)', tz: 'America/Toronto', flag: '🇨🇦' },

  // Zonas con offset fraccionario: la app las soporta desde el arreglo de
  // solapamiento parcial en src/slots.js, así que pueden ofrecerse sin riesgo.
  { country: 'India', tz: 'Asia/Kolkata', flag: '🇮🇳' },
  { country: 'Israel', tz: 'Asia/Jerusalem', flag: '🇮🇱' },
  { country: 'Emiratos Árabes', tz: 'Asia/Dubai', flag: '🇦🇪' },
  { country: 'Sudáfrica', tz: 'Africa/Johannesburg', flag: '🇿🇦' },
  { country: 'Australia (Sídney)', tz: 'Australia/Sydney', flag: '🇦🇺' },
  { country: 'Filipinas', tz: 'Asia/Manila', flag: '🇵🇭' }
];

// Bandera del país (fallback a globo si no está en la lista)
export const getCountryFlag = (countryName) => {
  if (!countryName) return '🌐';
  const cleanName = countryName.trim().toLowerCase();
  const matched = ZONAS.find(z =>
    z.country.toLowerCase().includes(cleanName) ||
    cleanName.includes(z.country.toLowerCase())
  );
  return matched ? matched.flag : '🌐';
};

// Nombre corto de la zona horaria (ciudad)
export const tzCity = (tz) => (tz || 'UTC').split('/').pop().replace(/_/g, ' ');

export const resolveTimezone = (countryName) => {
  if (!countryName) return 'UTC';
  const cleanName = countryName.trim().toLowerCase();
  
  // Buscar en las ZONAS predefinidas
  const matched = ZONAS.find(z => 
    z.country.toLowerCase().includes(cleanName) || 
    cleanName.includes(z.country.toLowerCase())
  );
  if (matched) return matched.tz;
  
  // Como fallback, usar la zona horaria real del navegador del usuario
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

// Adivina el país y la zona del usuario a partir de lo que reporta su
// navegador, para poder registrarlo sin pedirle que lo elija a mano.
//
// Cuando la zona del navegador NO está en la tabla, lo que se devuelve es esa
// zona real con el nombre de su ciudad, no un país inventado. Antes el fallback
// era 'Argentina': alguien entrando desde São Paulo, Bombay o Tel Aviv quedaba
// con horario de Buenos Aires, marcaba "libre de 9 a 12" y recibía propuestas
// corridas, sin enterarse nunca de por qué.
export const guessLocationFromBrowser = () => {
  let browserTz = 'UTC';
  try {
    browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return { country: 'Argentina', tz: 'America/Argentina/Buenos_Aires' };
  }
  const matched = ZONAS.find(z => z.tz === browserTz);
  if (matched) return { country: matched.country, tz: matched.tz };
  return { country: tzCity(browserTz), tz: browserTz };
};

// Compatibilidad: se mantiene por si algún llamador viejo la usa, pero ahora
// devuelve el país realmente detectado y no 'Argentina' por defecto.
export const guessCountryFromBrowserTz = () => guessLocationFromBrowser().country;
