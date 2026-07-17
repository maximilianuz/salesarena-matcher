-- Create meeting_attendees table for tracking attendance and punctuality
CREATE TABLE IF NOT EXISTS meeting_attendees (
  id BIGSERIAL PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_email TEXT NOT NULL,

  -- Estado de asistencia:
  -- 'confirmado': se confirmó inicialmente
  -- 'asistio': se presentó
  -- 'no_show': no se presentó (FALTA)
  -- 'cancelado_con_aviso': canceló con +24hs (sin penalizar)
  -- 'cancelado_tarde': canceló con <24hs (FALTA)
  status TEXT NOT NULL DEFAULT 'confirmado' CHECK (status IN (
    'confirmado', 'asistio', 'no_show', 'cancelado_con_aviso', 'cancelado_tarde'
  )),

  -- Puntualidad (solo cuando status = 'asistio')
  -- 'a_tiempo': llegó dentro de tolerancia (10 min)
  -- 'tarde': llegó después de 10 min
  punctuality TEXT CHECK (punctuality IS NULL OR punctuality IN ('a_tiempo', 'tarde')),

  -- Motivo obligatorio para cancelación tardía
  cancel_reason TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

  UNIQUE(meeting_id, member_email)
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_member_status
  ON meeting_attendees(member_email, status);

CREATE INDEX IF NOT EXISTS idx_meeting_attendees_meeting
  ON meeting_attendees(meeting_id);

-- RLS Policies
ALTER TABLE meeting_attendees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can see their own attendance"
  ON meeting_attendees FOR SELECT
  USING (auth.jwt() ->> 'email' = member_email);

CREATE POLICY "Members can update their own attendance"
  ON meeting_attendees FOR UPDATE
  USING (auth.jwt() ->> 'email' = member_email)
  WITH CHECK (auth.jwt() ->> 'email' = member_email);

CREATE POLICY "Service role can manage all attendance"
  ON meeting_attendees FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
