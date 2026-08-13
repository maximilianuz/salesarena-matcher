// Utilidades de presentación y de texto, sin estado ni dependencias de React.

// Iniciales para avatares (máx. 2 letras)
export const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
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
