-- Cuántos role-plays quiere hacer cada persona por semana.
--
-- Hasta ahora la app deducía esto de la disponibilidad: quien marcaba "libre
-- de 9 a 18" recibía una propuesta por cada hora marcada. Pero son dos
-- preguntas distintas y la segunda nunca se hacía:
--
--   ¿CUÁNDO podés?        -> el calendario
--   ¿CUÁNTAS querés?      -> esto
--
-- Leer una como si fuera la otra obligaba a poner un tope igual para todos
-- (eran 3), que le quedaba corto a quien tiene tiempo y ganas. Con la
-- pregunta hecha de frente, el tope deja de ser una regla impuesta y pasa a
-- ser lo que cada uno eligió.
--
-- No hay techo de producto: quien quiera entrenar intensivo pide lo que
-- quiera. El límite real lo ponen dos cosas que ya existen — sus propias
-- horas marcadas, y que del otro lado haya alguien con lugar disponible,
-- porque cada sesión consume el cupo de las DOS personas. Eso hace que el
-- sistema se autolimite sin necesidad de un número máximo.
--
-- El CHECK de 168 no es un tope de producto: es la cantidad de horas que
-- tiene una semana. Más sesiones que horas no es una preferencia, es un dato
-- imposible, y conviene que la base lo rechace antes de que llegue al motor.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS weekly_target SMALLINT NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.members'::regclass
      AND conname = 'members_weekly_target_sane'
  ) THEN
    ALTER TABLE public.members
      ADD CONSTRAINT members_weekly_target_sane
      CHECK (weekly_target >= 1 AND weekly_target <= 168);
  END IF;
END $$;

COMMENT ON COLUMN public.members.weekly_target IS
  'Cuántos role-plays quiere hacer esta persona por semana. Lo elige ella; el emparejador no le propone más que esto.';
