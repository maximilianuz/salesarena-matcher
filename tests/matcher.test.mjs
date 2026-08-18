// Tests del motor de coincidencias/emparejamiento semanal (src/matcher.js)
// combinado con la traducción de horarios locales a slots UTC (src/slots.js).
// Simula cómo la app encuentra (o no) coincidencias de horario entre miembros
// de distintos países. Corre con `npm test` (node --test, sin dependencias).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWeeklyPairs,
  buildWeeklyPairsMultiRound,
  soonestSlot,
  slotDateMs,
  respondByMs,
  currentWeekStartISO,
  MIN_LEAD_MS,
  CONFIRM_STEPS_MS,
  MAX_SESSIONS_PER_WEEK
} from '../src/matcher.js';
import { computeSlotSets, slotToLocalParts } from '../src/slots.js';

const AR = 'America/Argentina/Buenos_Aires'; // UTC-3 fijo
const MX = 'America/Mexico_City'; // UTC-6 fijo (sin DST desde 2022)
const EU2 = 'Etc/GMT-2'; // UTC+2 fijo (Madrid en verano)

// Jueves 16/07/2026 12:00 UTC como "ahora" determinista (semana del lunes 13)
const NOW = new Date(Date.UTC(2026, 6, 16, 12, 0, 0));

const member = (email, name, tz) => ({ email, name, tz });
const rule = (user, dayIdx, startHour, endHour) => ({ user, dayIdx, startHour, endHour });
const pairKey = (a, b) => [a, b].sort().join('|');

test('coincidencia básica: dos personas del mismo país que marcan lo mismo', () => {
  const members = [member('a@x.com', 'Ana', AR), member('b@x.com', 'Bruno', AR)];
  const avails = [rule('Ana', 0, 10, 12), rule('Bruno', 0, 11, 13)];
  const slotSets = computeSlotSets(members, avails);

  const { pairs, unmatched } = buildWeeklyPairs(members, slotSets, new Map(), new Set(), new Map(), NOW);
  assert.equal(pairs.length, 1);
  assert.equal(unmatched.length, 0);
  // Única hora común: Lunes 11:00 AR = Lunes 14:00 UTC → slot 14
  assert.equal(pairs[0].slot, 14);
  assert.deepEqual(slotToLocalParts(pairs[0].slot, AR), { dayIdx: 0, hour: 11 });
});

test('coincidencia entre países: Argentina 18:00 = España (verano) 23:00', () => {
  const members = [member('ar@x.com', 'Ari', AR), member('es@x.com', 'Elena', EU2)];
  const avails = [
    rule('Ari', 0, 18, 21),  // Lunes 18–21 AR → 21–24 UTC (slots 21,22,23)
    rule('Elena', 0, 23, 24) // Lunes 23–24 UTC+2 → 21–22 UTC (slot 21)
  ];
  const slotSets = computeSlotSets(members, avails);
  const { pairs } = buildWeeklyPairs(members, slotSets, new Map(), new Set(), new Map(), NOW);

  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].slot, 21);
  // Cada uno ve la MISMA reunión en su hora local
  assert.deepEqual(slotToLocalParts(21, AR), { dayIdx: 0, hour: 18 });
  assert.deepEqual(slotToLocalParts(21, EU2), { dayIdx: 0, hour: 23 });
});

test('coincidencia en el borde de la semana (Domingo noche Latam × Lunes madrugada Europa)', () => {
  // Domingo 22–24 en Argentina y Lunes 03–05 en UTC+2 son las MISMAS horas
  // UTC (Lunes 01–03, slots 1 y 2). Antes del fix de envolvente semanal esta
  // coincidencia jamás se detectaba: los slots del argentino se perdían.
  const members = [member('ar@x.com', 'Ari', AR), member('es@x.com', 'Elena', EU2)];
  const avails = [rule('Ari', 6, 22, 24), rule('Elena', 0, 3, 5)];
  const slotSets = computeSlotSets(members, avails);

  assert.deepEqual([...slotSets.get('ar@x.com')].sort((a, b) => a - b), [1, 2]);
  assert.deepEqual([...slotSets.get('es@x.com')].sort((a, b) => a - b), [1, 2]);

  const { pairs } = buildWeeklyPairs(members, slotSets, new Map(), new Set(), new Map(), NOW);
  assert.equal(pairs.length, 1);
  assert.ok([1, 2].includes(pairs[0].slot));
});

test('sin solapamiento horario: no hay pareja y ambos quedan sin asignar', () => {
  const members = [member('a@x.com', 'Ana', AR), member('m@x.com', 'Mia', MX)];
  const avails = [
    rule('Ana', 0, 8, 9), // Lunes 11:00 UTC
    rule('Mia', 0, 18, 19) // Martes 00:00 UTC
  ];
  const slotSets = computeSlotSets(members, avails);
  const { pairs, unmatched } = buildWeeklyPairs(members, slotSets, new Map(), new Set(), new Map(), NOW);
  assert.equal(pairs.length, 0);
  assert.deepEqual(unmatched.sort(), ['a@x.com', 'm@x.com']);
});

test('miembro sin disponibilidad cargada no entra al emparejamiento', () => {
  const members = [member('a@x.com', 'Ana', AR), member('b@x.com', 'Bruno', AR)];
  const avails = [rule('Ana', 0, 10, 12)]; // Bruno no cargó nada
  const slotSets = computeSlotSets(members, avails);
  const { pairs, unmatched } = buildWeeklyPairs(members, slotSets, new Map(), new Set(), new Map(), NOW);
  assert.equal(pairs.length, 0);
  // Solo Ana figura como "sin pareja"; Bruno ni siquiera participa
  assert.deepEqual(unmatched, ['a@x.com']);
});

test('pareja RECHAZADA esta semana no se vuelve a proponer', () => {
  const members = [member('a@x.com', 'Ana', AR), member('b@x.com', 'Bruno', AR)];
  const avails = [rule('Ana', 0, 10, 11), rule('Bruno', 0, 10, 11)];
  const slotSets = computeSlotSets(members, avails);
  const excluded = new Set([pairKey('a@x.com', 'b@x.com')]);
  const { pairs } = buildWeeklyPairs(members, slotSets, new Map(), excluded, new Map(), NOW);
  assert.equal(pairs.length, 0);
});

test('pareja EXPIRADA se evita si hay alternativa, pero se re-ofrece si es la única', () => {
  const a = member('a@x.com', 'Ana', 'UTC');
  const b = member('b@x.com', 'Bruno', 'UTC');
  const c = member('c@x.com', 'Cami', 'UTC');
  const avails = [rule('Ana', 0, 10, 11), rule('Bruno', 0, 10, 11), rule('Cami', 0, 10, 11)];
  const soft = new Set([pairKey('a@x.com', 'b@x.com')]);

  // Con alternativa (Cami): Ana evita a Bruno
  let slotSets = computeSlotSets([a, b, c], avails);
  let { pairs } = buildWeeklyPairs([a, b, c], slotSets, new Map(), new Set(), new Map(), NOW, soft);
  const anaPair = pairs.find(p => p.a.email === 'a@x.com' || p.b.email === 'a@x.com');
  assert.ok(anaPair);
  assert.equal([anaPair.a.email, anaPair.b.email].includes('c@x.com'), true);

  // Sin alternativa: la dupla expirada se vuelve a ofrecer
  slotSets = computeSlotSets([a, b], avails);
  ({ pairs } = buildWeeklyPairs([a, b], slotSets, new Map(), new Set(), new Map(), NOW, soft));
  assert.equal(pairs.length, 1);
});

test('rotación anti-amiguismo: se prefiere el compañero con MENOS reuniones previas', () => {
  const a = member('a@x.com', 'Ana', 'UTC');
  const b = member('b@x.com', 'Bruno', 'UTC');
  const c = member('c@x.com', 'Cami', 'UTC');
  const avails = ['Ana', 'Bruno', 'Cami'].map(u => rule(u, 0, 10, 11));
  const slotSets = computeSlotSets([a, b, c], avails);
  const pairCounts = new Map([[pairKey('a@x.com', 'b@x.com'), 3]]);

  const { pairs } = buildWeeklyPairs([a, b, c], slotSets, new Map(), new Set(), pairCounts, NOW);
  const anaPair = pairs.find(p => p.a.email === 'a@x.com' || p.b.email === 'a@x.com');
  assert.equal([anaPair.a.email, anaPair.b.email].includes('c@x.com'), true);
});

test('prioridad por confiabilidad: el mejor score elige primero y elige al mejor', () => {
  const a = member('a@x.com', 'Ana', 'UTC');
  const b = member('b@x.com', 'Bruno', 'UTC');
  const c = member('c@x.com', 'Cami', 'UTC');
  const avails = ['Ana', 'Bruno', 'Cami'].map(u => rule(u, 0, 10, 11));
  const slotSets = computeSlotSets([a, b, c], avails);
  const scores = new Map([['a@x.com', 90], ['b@x.com', 80], ['c@x.com', 10]]);

  const { pairs, unmatched } = buildWeeklyPairs([a, b, c], slotSets, scores, new Set(), new Map(), NOW);
  assert.equal(pairs.length, 1);
  const emails = [pairs[0].a.email, pairs[0].b.email].sort();
  assert.deepEqual(emails, ['a@x.com', 'b@x.com']);
  assert.deepEqual(unmatched, ['c@x.com']);
});

test('soonestSlot: elige la ocurrencia MÁS PRÓXIMA, no el primer día de la semana', () => {
  // "Ahora" es jueves. Lunes 10:00 (slot 10) recién ocurre la semana que
  // viene; Viernes 10:00 (slot 106) es mañana → debe ganar el viernes.
  const monday10 = 10;
  const friday10 = 4 * 24 + 10;
  assert.equal(soonestSlot([monday10, friday10], NOW), friday10);
  assert.equal(slotDateMs(friday10, NOW), Date.UTC(2026, 6, 17, 10));
});

test('soonestSlot respeta la antelación mínima (un slot inminente rueda a la otra semana)', () => {
  // Jueves 12:20 UTC: el slot de las 12:00 de hoy ya empezó → próxima
  // ocurrencia válida es el jueves siguiente.
  const now = new Date(Date.UTC(2026, 6, 16, 12, 20));
  const thursday12 = 3 * 24 + 12;
  assert.equal(slotDateMs(thursday12, now, MIN_LEAD_MS), Date.UTC(2026, 6, 23, 12));
});

test('respondByMs: ventana escalonada 4h → 2h → 1h → 30m', () => {
  const t0 = NOW.getTime();
  const H = 3600e3;
  assert.equal(respondByMs(t0 + 5 * H, NOW), t0 + 5 * H - 4 * H);   // entra el escalón de 4h
  assert.equal(respondByMs(t0 + 3 * H, NOW), t0 + 3 * H - 2 * H);   // 2h
  assert.equal(respondByMs(t0 + 1.5 * H, NOW), t0 + 1.5 * H - 1 * H); // 1h
  assert.equal(respondByMs(t0 + 0.75 * H, NOW), t0 + 0.75 * H - 0.5 * H); // 30m
  assert.equal(respondByMs(t0 + 0.25 * H, NOW), null); // <30min: no se propone
  assert.equal(MIN_LEAD_MS, CONFIRM_STEPS_MS[CONFIRM_STEPS_MS.length - 1]);
});

test('un slot elegido por el motor SIEMPRE tiene ventana de confirmación', () => {
  // El borde: "ahora" es 11:30:00.000 exactas y el slot de las 12:00 está a
  // exactamente MIN_LEAD_MS. El motor lo daba por bueno pero respondByMs
  // devolvía null para esa misma reunión — una propuesta sin plazo posible.
  // Ahora el piso es estricto: ese slot rueda a la semana siguiente.
  const now = new Date(Date.UTC(2026, 6, 16, 11, 30, 0, 0));
  const thursday12 = 3 * 24 + 12;

  const elegido = slotDateMs(thursday12, now, MIN_LEAD_MS);
  assert.equal(elegido, Date.UTC(2026, 6, 23, 12), 'rueda a la semana siguiente');
  assert.notEqual(respondByMs(elegido, now), null, 'y tiene plazo para confirmar');
});

test('currentWeekStartISO: siempre un lunes (UTC)', () => {
  assert.equal(currentWeekStartISO(NOW), '2026-07-13');
  const sunday = new Date(Date.UTC(2026, 6, 19, 23, 59));
  assert.equal(currentWeekStartISO(sunday), '2026-07-13');
  const monday = new Date(Date.UTC(2026, 6, 20, 0, 0));
  assert.equal(currentWeekStartISO(monday), '2026-07-20');
});

test('escenario integral: sala multi-país, el matcher encuentra todas las duplas posibles', () => {
  // 4 miembros, 3 países. Ana(AR) y Elena(ES) coinciden de noche;
  // Mia(MX) y Bruno(AR) coinciden a la tarde.
  const members = [
    member('ana@x.com', 'Ana', AR),
    member('elena@x.com', 'Elena', EU2),
    member('mia@x.com', 'Mia', MX),
    member('bruno@x.com', 'Bruno', AR)
  ];
  const avails = [
    rule('Ana', 1, 18, 20),   // Martes 21–23 UTC
    rule('Elena', 1, 23, 24), // Martes 21–22 UTC
    rule('Mia', 2, 12, 14),   // Miércoles 18–20 UTC
    rule('Bruno', 2, 15, 17)  // Miércoles 18–20 UTC
  ];
  const slotSets = computeSlotSets(members, avails);
  const { pairs, unmatched } = buildWeeklyPairs(members, slotSets, new Map(), new Set(), new Map(), NOW);

  assert.equal(pairs.length, 2);
  assert.equal(unmatched.length, 0);
  const keys = pairs.map(p => pairKey(p.a.email, p.b.email)).sort();
  assert.deepEqual(keys, [
    pairKey('ana@x.com', 'elena@x.com'),
    pairKey('bruno@x.com', 'mia@x.com')
  ].sort());
});

// --- MULTI-MATCH SEMANAL: varias propuestas por persona, nunca superpuestas ---
// No hay tope de propuestas: el límite lo pone la disponibilidad. Lo que sí es
// invariante es que nadie puede quedar con dos role-plays a la misma hora.

test('multi-ronda: varias propuestas por persona, ninguna en el mismo horario', () => {
  // Seis personas con la MISMA disponibilidad amplia: el caso donde el motor
  // más tiende a repetir el horario común más próximo en cada ronda.
  const members = ['ana', 'beto', 'caro', 'dani', 'eva', 'fito']
    .map(n => member(`${n}@x.com`, n, AR));
  const avails = members.flatMap(m => [rule(m.name, 0, 10, 15)]);
  const slotSets = computeSlotSets(members, avails);

  const pairs = buildWeeklyPairsMultiRound(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS
  );

  assert.ok(pairs.length > members.length / 2, 'debe emparejar en más de una ronda');

  const taken = new Map(); // email -> Set<slot>
  for (const p of pairs) {
    for (const who of [p.a.email, p.b.email]) {
      if (!taken.has(who)) taken.set(who, new Set());
      assert.ok(
        !taken.get(who).has(p.slot),
        `${who} quedó con dos reuniones en el slot ${p.slot}`
      );
      taken.get(who).add(p.slot);
    }
  }
});

test('multi-ronda: agota los compañeros NUEVOS antes de repetir uno', () => {
  // Cuatro personas con la misma franja amplia: hay de sobra con quién
  // emparejar, así que nadie debería repetir compañero mientras queden caras
  // nuevas disponibles.
  const members = ['ana', 'beto', 'caro', 'dani']
    .map(n => member(`${n}@x.com`, n, AR));
  const avails = members.flatMap(m => [rule(m.name, 0, 9, 12)]);
  const slotSets = computeSlotSets(members, avails);

  const pairs = buildWeeklyPairsMultiRound(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS
  );

  // Con 3 horas por persona y 3 compañeros posibles, alcanza para que cada
  // dupla sea distinta: la primera repetición recién aparecería al agotarlas.
  const keys = pairs.map(p => pairKey(p.a.email, p.b.email));
  assert.equal(new Set(keys).size, keys.length, 'repitió dupla habiendo caras nuevas');
});

test('multi-ronda: repite la dupla SOLO cuando no queda nadie más', () => {
  // Dos personas solas en la sala, con tres horas en común. Antes salía una
  // sola sesión y las otras dos horas se desperdiciaban; ahora se aprovechan.
  const members = [member('a@x.com', 'Ana', AR), member('b@x.com', 'Beto', AR)];
  const avails = [rule('Ana', 0, 10, 13), rule('Beto', 0, 10, 13)];
  const slotSets = computeSlotSets(members, avails);

  const pairs = buildWeeklyPairsMultiRound(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS
  );

  assert.equal(pairs.length, 3, 'debe usar las tres horas en común');
  const slots = pairs.map(p => p.slot);
  assert.equal(new Set(slots).size, 3, 'cada sesión en una hora distinta');
});

test('la hora elegida no deja sin sesión a quien tiene una sola disponible', () => {
  // Ana y Caro tienen dos horas; Beto solo la primera. Si Ana y Caro se quedan
  // con esa hora, Beto pierde su única chance de la semana. El motor tiene que
  // correrse a la otra hora, que no le sirve a nadie más.
  const members = [
    member('ana@x.com', 'Ana', AR),
    member('beto@x.com', 'Beto', AR),
    member('caro@x.com', 'Caro', AR)
  ];
  const avails = [
    rule('Ana', 0, 10, 12),
    rule('Beto', 0, 10, 11),
    rule('Caro', 0, 10, 12)
  ];
  const slotSets = computeSlotSets(members, avails);

  const pairs = buildWeeklyPairsMultiRound(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS
  );

  const emparejados = new Set(pairs.flatMap(p => [p.a.email, p.b.email]));
  assert.ok(emparejados.has('beto@x.com'), 'Beto quedó sin sesión pudiendo tenerla');
  assert.ok(pairs.length >= 2, 'debía salir más de un emparejamiento');
});

test('la rotación no manda a alguien que nunca se conecta por ser cara nueva', () => {
  // Un compañero confiable con quien ya te juntaste una vez le gana a uno con
  // el que nunca te juntaste pero que casi nunca aparece. Sin este contrapeso,
  // la rotación pura premiaba al ausente y dejaba esperando a quien se prepara.
  const members = [
    member('ana@x.com', 'Ana', AR),
    member('fiel@x.com', 'Fiel', AR),
    member('ausente@x.com', 'Ausente', AR)
  ];
  const avails = [rule('Ana', 0, 10, 11), rule('Fiel', 0, 10, 11), rule('Ausente', 0, 10, 11)];
  const slotSets = computeSlotSets(members, avails);
  const scores = new Map([['ana@x.com', 80], ['fiel@x.com', 95], ['ausente@x.com', 5]]);
  const pairCounts = new Map([[pairKey('ana@x.com', 'fiel@x.com'), 1]]);

  const pairs = buildWeeklyPairsMultiRound(
    members, slotSets, scores, new Set(), pairCounts, NOW, new Set(), MIN_LEAD_MS
  );

  assert.equal(pairs.length, 1, 'solo hay una hora, sale una sola dupla');
  const dupla = [pairs[0].a.name, pairs[0].b.name].sort().join('+');
  assert.equal(dupla, 'Ana+Fiel');
});

test('busySlots: no se ofrece un horario que la persona ya tiene comprometido', () => {
  // Ana y Bruno coinciden SOLO en Lunes 11:00 AR (slot 14). Si Ana ya tiene
  // una propuesta viva en ese slot con otra persona, no puede volver a
  // ofrecerse: no le queda hora libre en común con Bruno.
  const members = [member('a@x.com', 'Ana', AR), member('b@x.com', 'Bruno', AR)];
  const avails = [rule('Ana', 0, 10, 12), rule('Bruno', 0, 11, 13)];
  const slotSets = computeSlotSets(members, avails);

  const libre = buildWeeklyPairs(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS, new Map()
  );
  assert.equal(libre.pairs.length, 1);
  assert.equal(libre.pairs[0].slot, 14);

  const ocupada = buildWeeklyPairs(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS,
    new Map([['a@x.com', new Set([14])]])
  );
  assert.equal(ocupada.pairs.length, 0, 'Ana ya estaba ocupada en el slot 14');
});

test('busySlots: con otra hora libre, se corre a esa en vez de descartar la dupla', () => {
  const members = [member('a@x.com', 'Ana', AR), member('b@x.com', 'Bruno', AR)];
  // Coinciden Lunes 11:00 y 12:00 AR → slots 14 y 15
  const avails = [rule('Ana', 0, 10, 13), rule('Bruno', 0, 11, 13)];
  const slotSets = computeSlotSets(members, avails);

  const { pairs } = buildWeeklyPairs(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS,
    new Map([['b@x.com', new Set([14])]])
  );
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].slot, 15, 'debía correrse al único horario libre');
});

test('busySlots: la key se compara sin distinguir mayúsculas', () => {
  const members = [member('A@X.com', 'Ana', AR), member('b@x.com', 'Bruno', AR)];
  const avails = [rule('Ana', 0, 10, 12), rule('Bruno', 0, 11, 13)];
  const slotSets = computeSlotSets(members, avails);

  const { pairs } = buildWeeklyPairs(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS,
    new Map([['a@x.com', new Set([14])]])
  );
  assert.equal(pairs.length, 0);
});

test('multi-ronda: no muta el Map de horarios ocupados que recibe', () => {
  const members = ['ana', 'beto', 'caro', 'dani']
    .map(n => member(`${n}@x.com`, n, AR));
  const avails = members.flatMap(m => [rule(m.name, 0, 9, 18)]);
  const slotSets = computeSlotSets(members, avails);

  const busy = new Map([['ana@x.com', new Set([100])]]);
  buildWeeklyPairsMultiRound(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS, busy
  );
  assert.deepEqual([...busy.get('ana@x.com')], [100]);
  assert.equal(busy.size, 1);
});

test('tope semanal: marcar el día entero no genera una sesión por hora', () => {
  // "Libre lunes de 9 a 18" significa "cualquiera de esas horas me sirve", no
  // "agendame nueve role-plays el lunes". Sin tope, seis personas con nueve
  // horas marcadas generaban 27 propuestas y la misma dupla se repetía once
  // veces, con lo que la rotación dejaba de significar algo.
  const members = ['ana', 'beto', 'caro', 'dani', 'eva', 'fito']
    .map(n => member(`${n}@x.com`, n, AR));
  const avails = members.flatMap(m => [rule(m.name, 0, 9, 18)]);
  const slotSets = computeSlotSets(members, avails);

  const pairs = buildWeeklyPairsMultiRound(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS
  );

  const porPersona = new Map();
  for (const p of pairs) {
    for (const e of [p.a.email, p.b.email]) {
      porPersona.set(e, (porPersona.get(e) ?? 0) + 1);
    }
  }
  for (const [email, n] of porPersona) {
    assert.ok(n <= MAX_SESSIONS_PER_WEEK, `${email} quedó con ${n} sesiones`);
  }
});

test('tope semanal: cuenta las propuestas que la persona YA tiene', () => {
  // El cron corre cada 10 minutos. Si el tope contara solo lo de esta corrida,
  // cada pasada volvería a sumarle el tope entero a la misma persona.
  const members = ['ana', 'beto', 'caro', 'dani']
    .map(n => member(`${n}@x.com`, n, AR));
  const avails = members.flatMap(m => [rule(m.name, 0, 9, 18)]);
  const slotSets = computeSlotSets(members, avails);

  // Ana ya llegó al tope en corridas anteriores; el resto no tiene nada.
  const yaTiene = new Map([['ana@x.com', MAX_SESSIONS_PER_WEEK]]);

  const pairs = buildWeeklyPairsMultiRound(
    members, slotSets, new Map(), new Set(), new Map(), NOW, new Set(), MIN_LEAD_MS,
    new Map(), yaTiene
  );

  const deAna = pairs.filter(p => p.a.email === 'ana@x.com' || p.b.email === 'ana@x.com');
  assert.equal(deAna.length, 0, 'Ana ya estaba en el tope y volvió a recibir propuestas');
  assert.ok(pairs.length > 0, 'los demás sí deben seguir emparejándose');
});
