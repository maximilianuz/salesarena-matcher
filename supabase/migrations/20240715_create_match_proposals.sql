-- Match Proposals Table
-- Almacena propuestas de emparejamiento 1:1 generadas por weekly-matcher
CREATE TABLE IF NOT EXISTS match_proposals (
  id BIGSERIAL PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  week_start DATE NOT NULL, -- lunes UTC (YYYY-MM-DD) de la semana

  -- Miembros de la pareja
  member_a_email TEXT NOT NULL,
  member_a_name TEXT NOT NULL,
  member_b_email TEXT NOT NULL,
  member_b_name TEXT NOT NULL,

  -- Slot horario (0-167, donde cada slot = 1 hora UTC de la semana)
  slot_start SMALLINT NOT NULL CHECK (slot_start >= 0 AND slot_start <= 167),

  -- Confirmación doble opt-in:
  -- null: no respondida
  -- 'si': aceptó la propuesta
  -- 'no': rechazó la propuesta
  status_a TEXT CHECK (status_a IS NULL OR status_a IN ('si', 'no')),
  status_b TEXT CHECK (status_b IS NULL OR status_b IN ('si', 'no')),

  -- Estado general de la propuesta:
  -- 'propuesto': pendiente de confirmación
  -- 'confirmado': ambos aceptaron
  -- 'rechazado': al menos uno dijo que no
  -- 'expirado': pasó respond_by sin respuesta
  status TEXT NOT NULL DEFAULT 'propuesto' CHECK (status IN ('propuesto', 'confirmado', 'rechazado', 'expirado')),

  -- Fecha límite para responder
  respond_by TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Reunión creada (ID del meeting en Google Calendar si aplica)
  meeting_id TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

  UNIQUE(room_id, week_start, member_a_email, member_b_email)
);

-- Índices
CREATE INDEX idx_match_proposals_room_week ON match_proposals(room_id, week_start);
CREATE INDEX idx_match_proposals_status ON match_proposals(status);
CREATE INDEX idx_match_proposals_respond_by ON match_proposals(respond_by);
CREATE INDEX idx_match_proposals_member_a ON match_proposals(member_a_email);
CREATE INDEX idx_match_proposals_member_b ON match_proposals(member_b_email);

-- RLS Policy: Cada usuario solo ve sus propias propuestas
ALTER TABLE match_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own proposals"
  ON match_proposals FOR SELECT
  USING (auth.jwt() ->> 'email' IN (member_a_email, member_b_email));

CREATE POLICY "Users can update their own proposal status"
  ON match_proposals FOR UPDATE
  TO authenticated
  USING (auth.jwt() ->> 'email' IN (member_a_email, member_b_email))
  WITH CHECK (auth.jwt() ->> 'email' IN (member_a_email, member_b_email));

-- Service role (Edge Function) puede insertar y cambiar status global
CREATE POLICY "Service role can manage proposals"
  ON match_proposals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
