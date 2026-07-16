-- Fix: la política RLS de SELECT sobre match_proposals referenciaba una columna
-- 'role' en la tabla 'members' que no existe en producción. Al evaluar la
-- política, Postgres fallaba con "column role does not exist", de modo que
-- CUALQUIER consulta del cliente autenticado a match_proposals devolvía error
-- y la app nunca podía cargar la propuesta del usuario (mostraba "sin
-- compañero asignado" aunque la fila existiera en la base).
--
-- El SQL Editor (rol postgres) ignora RLS, por eso ahí sí se veía la fila.
--
-- La cláusula 'founder ve todo' no la usa el cliente (la consulta de la app
-- siempre filtra por el email propio), así que se elimina. La política queda
-- en su forma simple y correcta: cada usuario ve las propuestas donde su email
-- participa como member_a o member_b.

DROP POLICY IF EXISTS "Users can only see match proposals they're in" ON match_proposals;
DROP POLICY IF EXISTS "Users can view their own proposals" ON match_proposals;

CREATE POLICY "Users can view their own proposals"
  ON match_proposals FOR SELECT
  USING (auth.jwt() ->> 'email' IN (member_a_email, member_b_email));
