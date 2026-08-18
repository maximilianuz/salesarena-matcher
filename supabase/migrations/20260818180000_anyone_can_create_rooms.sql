-- Crear una sala deja de ser exclusivo del administrador de plataforma.
--
-- La política anterior (20260813120000) lo restringía a is_platform_admin(),
-- y hasta la propia app lo decía con un "por el momento". Cualquier persona
-- autenticada puede ahora armar su sala y repartir su enlace de invitación.
--
-- Lo que NO cambia: quien crea una sala es su dueño y nadie más la administra.
-- Las políticas de UPDATE y DELETE ya usan is_room_admin(id), que solo da true
-- al fundador de ESA sala (o al administrador de plataforma). Nadie puede
-- renombrar ni borrar la sala de otra persona, y esta migración no las toca.
--
-- El WITH CHECK es la parte que sostiene todo eso: obliga a que founder_email
-- sea el email de quien está creando. Sin esa condición, cualquiera podría
-- crear una sala a nombre de otro —o sin dueño, que quedaría sin nadie que
-- pueda administrarla ni borrarla nunca.

DROP POLICY IF EXISTS "Platform admin can create rooms" ON public.rooms;

CREATE POLICY "Authenticated users create their own rooms"
  ON public.rooms FOR INSERT
  TO authenticated
  WITH CHECK (
    founder_email IS NOT NULL
    AND lower(founder_email) = lower(nullif(auth.jwt() ->> 'email', ''))
  );
