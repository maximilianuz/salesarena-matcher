-- Agregar columna joined_at a match_proposals
-- Registra cuando el usuario clickea el Meet link (con tolerancia de 10 min automática)

ALTER TABLE match_proposals
ADD COLUMN joined_at TIMESTAMP WITH TIME ZONE;

-- Índice para consultas de asistencia
CREATE INDEX idx_match_proposals_joined_at ON match_proposals(joined_at);

-- Comentario de documentación
COMMENT ON COLUMN match_proposals.joined_at IS
'Timestamp cuando el usuario clickeó el link de Google Meet.
Usado para validar asistencia automática con tolerancia de 10 minutos.';
