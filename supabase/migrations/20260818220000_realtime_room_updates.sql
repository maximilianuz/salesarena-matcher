-- Actualización en vivo de la sala.
--
-- Hasta ahora la app leía los datos de la sala UNA sola vez, al abrirla. Nada
-- de lo que hacía la otra persona —aceptar la propuesta, crear el Meet,
-- cancelar— se veía hasta recargar la página a mano. Como además el cron corre
-- cada 10 minutos, la sensación era que "la app tarda 10 minutos", cuando en
-- realidad el dato ya estaba en la base y solo faltaba traerlo.
--
-- Con estas tablas publicadas, el cliente se suscribe a los cambios de SU sala
-- y refresca solo. Realtime respeta las políticas RLS que ya existen: cada
-- quien recibe únicamente los cambios de las filas que de todos modos podría
-- leer, así que esto no abre ningún dato nuevo.
--
-- session_closeouts queda FUERA a propósito: es la tabla del sobre cerrado y
-- no tiene ninguna política de lectura. Publicarla sería justamente la fuga que
-- todo ese diseño evita.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['match_proposals', 'meetings', 'meeting_attendees', 'members', 'availabilities']
  LOOP
    -- Se agrega solo si no está ya publicada: ALTER PUBLICATION falla si la
    -- tabla ya pertenece a la publicación, y esta migración tiene que poder
    -- correrse dos veces sin romperse.
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
EXCEPTION WHEN undefined_object THEN
  -- La publicación supabase_realtime no existe (proyecto sin Realtime
  -- habilitado). No es un error fatal: la app tiene un refresco de respaldo
  -- al volver a la pestaña, así que se sigue sin live updates.
  RAISE NOTICE 'supabase_realtime no existe: la app usará solo el refresco al volver a la pestaña.';
END $$;
