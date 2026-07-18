-- La tabla members de producción no tiene country ni active, pero el
-- cliente los envía en cada registro (App.jsx registerMember) y los usa
-- para el matching (active) y la UI (country). Sin estas columnas, todo
-- INSERT de registro falla con 400 (42703 undefined column).

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS country TEXT;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
