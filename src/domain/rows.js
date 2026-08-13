// Traducción entre las filas que devuelve Supabase (snake_case) y los objetos
// que usa la app (camelCase), más los mensajes de error del alta a una sala.
//
// Cada uno de estos mapeos estaba escrito varias veces dentro del componente:
// agregar una columna obligaba a acordarse de tocar todas las copias.

// Fila de availabilities/templates → regla horaria de la app. Ambas tablas
// tienen la misma forma, así que comparten mapeo. memberEmail es el vínculo
// real con el miembro; `user` (el nombre) se conserva para las etiquetas del
// mapa de calor y como respaldo de las filas anteriores a esa columna.
export const scheduleRuleFromRow = (row) => ({
  memberEmail: row.member_email || null,
  user: row.user,
  dayIdx: row.day_idx,
  startHour: row.start_hour,
  endHour: row.end_hour
});

// Fila de meeting_attendees → objeto de asistencia de la app. Este mapeo de
// nueve campos estaba escrito tres veces (carga inicial y creación de reunión);
// agregar una columna obligaba a acordarse de tocar todas las copias.
export const attendanceFromRow = (row) => ({
  id: row.id,
  meetingId: row.meeting_id,
  memberEmail: row.member_email,
  memberName: row.member_name,
  status: row.status,
  punctuality: row.punctuality,
  cancelReason: row.cancel_reason,
  reportedBy: row.reported_by,
  reportedAt: row.reported_at,
  joinedAt: row.joined_at
});

// join_room señala cada motivo de rechazo con un código propio. Se traducen a
// un mensaje que le diga a la persona qué hacer, en vez de mostrarle el texto
// crudo de Postgres.
export const joinRoomErrorMessage = (error) => {
  const raw = `${error?.message || ''} ${error?.details || ''}`;
  if (raw.includes('INVALID_CODE')) {
    return 'El enlace de invitación no es válido o fue renovado. Pedile a quien administra la sala que te comparta el enlace actual.';
  }
  if (raw.includes('ROOM_CLOSED')) {
    return 'Esta sala todavía no tiene invitaciones habilitadas. Pedile el enlace a quien la administra.';
  }
  if (raw.includes('ROOM_NOT_FOUND')) {
    return 'Esta sala todavía no fue creada. Pedile el enlace correcto a quien administra la plataforma.';
  }
  if (raw.includes('AUTH_REQUIRED')) {
    return 'Tu sesión venció antes de completar el registro. Volvé a iniciar sesión con Google.';
  }
  return 'No pudimos completar tu registro. Volvé a intentarlo en un momento.';
};
