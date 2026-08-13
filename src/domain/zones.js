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
  { country: 'República Checa', tz: 'Europe/Prague', flag: '🇨🇿' }
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

// Adivina el país del usuario a partir de la zona horaria que reporta su
// navegador, para poder registrarlo sin pedirle que lo elija a mano.
export const guessCountryFromBrowserTz = () => {
  try {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const matched = ZONAS.find(z => z.tz === browserTz);
    return matched ? matched.country : 'Argentina';
  } catch {
    return 'Argentina';
  }
};
