-- Agregar columna reassignment_count a match_proposals
-- Rastrea cuántas veces una propuesta ha sido reasignada (escalones: 4h→2h→1h→30m)

ALTER TABLE match_proposals
ADD COLUMN reassignment_count SMALLINT DEFAULT 0 CHECK (reassignment_count >= 0);

-- Índice para consultas de reasignaciones
CREATE INDEX idx_match_proposals_reassignment_count ON match_proposals(reassignment_count);

-- Comentario de documentación
COMMENT ON COLUMN match_proposals.reassignment_count IS
'Número de reasignaciones. Determina ventana de confirmación:
  0 = 4h (propuesta inicial)
  1 = 2h (1ª reasignación)
  2 = 1h (2ª reasignación)
  3+ = 30m (3ª+ reasignación)';
