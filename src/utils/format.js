// Utilidades de presentación y de texto, sin estado ni dependencias de React.

// Iniciales para avatares (máx. 2 letras)
// El nombre puede llegar como espacios en blanco desde la base (alta manual con
// la barra espaciadora). `!name` no atrapa ese caso —un string de espacios es
// truthy— y sin el filtro de vacíos el split devuelve [''], con lo que las
// iniciales terminaban siendo el texto literal "UNDEFINED" en el avatar.
export const getInitials = (name) => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
};

// Color de avatar estable por nombre
export const AVATAR_COLORS = ['#5e5ce6', '#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a'];
export const getAvatarColor = (name) => {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

// Patrón LIKE/ILIKE seguro para un valor literal (escapa %, _ y \).
// Se usa para borrar/actualizar filas por nombre de usuario sin distinguir
// mayúsculas: la tabla availabilities guarda "user" como texto libre y un
// .eq() estricto dejaba filas viejas huérfanas si el nombre cambió de casing.
export const escapeLikeLiteral = (value) => value.replace(/[\\%_]/g, '\\$&');

// Deriva un nombre presentable del email cuando la cuenta de Google no
// trae nombre (ej. "carlos.mendoza@gmail.com" → "Carlos Mendoza").
export const nameFromEmail = (email) => {
  const base = (email || '').split('@')[0];
  const pretty = base
    .replace(/[._\-+]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return pretty || 'Invitado';
};

// Espera N milisegundos. Se usa para escalonar los pasos visibles del
// asistente de agendado.
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Nombre de sala → slug de la URL. Vivía duplicado carácter por carácter en
// handleRenameRoom y handleCreateRoom: si las dos copias se desincronizaban,
// crear y renombrar generaban enlaces distintos para el mismo nombre.
export const slugifyRoomName = (name) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes
    .replace(/[^a-z0-9\s-]/g, '')    // quita símbolos
    .trim()
    .replace(/\s+/g, '-');

// Enlace para agregar un role-play al calendario propio, en el formato de
// plantilla de Google Calendar.
//
// Existe porque el evento automático no siempre llega a las dos personas: lo
// crea quien acepta segundo, con SU permiso de Google —que vence en una hora y
// Supabase no renueva—, y la otra lo recibe como invitación, que Google agrega
// o no según la configuración de cada cuenta. Este enlace no depende de ningún
// token ni de quién organizó: cada quien lo agrega al suyo con un clic.
//
// startsAt es ISO; la duración va en minutos.
export const googleCalendarUrl = ({ title, startsAt, durationMin = 60, meetLink, details }) => {
  // El chequeo de vacío va ANTES de construir la fecha: new Date(null) no es
  // inválida, es el 1 de enero de 1970, así que sin esto una reunión sin
  // starts_at ofrecía un enlace para agendar medio siglo atrás.
  if (!startsAt) return null;
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + durationMin * 60000);
  // Google espera YYYYMMDDTHHMMSSZ, que es el ISO sin guiones ni milisegundos.
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Role-play',
    dates: `${stamp(start)}/${stamp(end)}`,
    details: [details, meetLink ? `Videollamada: ${meetLink}` : '']
      .filter(Boolean).join('\n\n'),
    location: meetLink || ''
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};
