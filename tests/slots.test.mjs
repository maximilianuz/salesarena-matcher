// Tests de la traducción hora local → slots UTC y del mapa de calor.
// Corre con `npm test` (node --test, sin dependencias).
//
// Se usan zonas SIN horario de verano para que los offsets sean deterministas
// todo el año: Buenos Aires (-3), Bogotá (-5), Ciudad de México (-6, sin DST
// desde 2022), Etc/GMT-2 (= UTC+2 fijo) y Asia/Kolkata (+5:30).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getOffsetMinutes,
  memberSlotSet,
  computeSlotSets,
  buildHeatmapGrid,
  slotToLocalParts
} from '../src/slots.js';

const AR = 'America/Argentina/Buenos_Aires'; // UTC-3
const CO = 'America/Bogota'; // UTC-5
const EU2 = 'Etc/GMT-2'; // UTC+2 fijo (equivale a Madrid en verano)

test('getOffsetMinutes: offsets conocidos', () => {
  assert.equal(getOffsetMinutes('UTC'), 0);
  assert.equal(getOffsetMinutes(AR), -180);
  assert.equal(getOffsetMinutes(CO), -300);
  assert.equal(getOffsetMinutes(EU2), 120);
  assert.equal(getOffsetMinutes('Asia/Kolkata'), 330);
  assert.equal(getOffsetMinutes('Zona/Inexistente'), 0); // fallback UTC
});

test('memberSlotSet: bloque local simple se traduce al slot UTC correcto', () => {
  // Lunes 10:00–12:00 en Argentina = Lunes 13:00–15:00 UTC → slots 13 y 14
  const set = memberSlotSet([{ dayIdx: 0, startHour: 10, endHour: 12 }], AR);
  assert.deepEqual([...set].sort((a, b) => a - b), [13, 14]);
});

test('memberSlotSet: envolvente semanal hacia adelante (Domingo tarde en Latam)', () => {
  // Domingo 22:00–24:00 en Argentina = Lunes 01:00–03:00 UTC → slots 1 y 2.
  // Antes del fix estos bloques se PERDÍAN (quedaban fuera del rango 0..167).
  const set = memberSlotSet([{ dayIdx: 6, startHour: 22, endHour: 24 }], AR);
  assert.deepEqual([...set].sort((a, b) => a - b), [1, 2]);
});

test('memberSlotSet: envolvente semanal hacia atrás (Lunes de madrugada en Europa)', () => {
  // Lunes 00:00–02:00 en UTC+2 = Domingo 22:00–24:00 UTC → slots 166 y 167.
  const set = memberSlotSet([{ dayIdx: 0, startHour: 0, endHour: 2 }], EU2);
  assert.deepEqual([...set].sort((a, b) => a - b), [166, 167]);
});

test('memberSlotSet: offset fraccionario (India) solapa dos slots por hora', () => {
  // Lunes 10:00–11:00 en Kolkata = Lunes 04:30–05:30 UTC → slots 4 y 5
  const set = memberSlotSet([{ dayIdx: 0, startHour: 10, endHour: 11 }], 'Asia/Kolkata');
  assert.deepEqual([...set].sort((a, b) => a - b), [4, 5]);
});

test('memberSlotSet: reglas superpuestas no duplican slots', () => {
  const set = memberSlotSet([
    { dayIdx: 0, startHour: 10, endHour: 12 },
    { dayIdx: 0, startHour: 11, endHour: 13 }
  ], 'UTC');
  assert.deepEqual([...set].sort((a, b) => a - b), [10, 11, 12]);
});

test('slotToLocalParts: inversa consistente con memberSlotSet', () => {
  // Slot 13 (Lunes 13:00 UTC) visto desde Argentina = Lunes 10:00
  assert.deepEqual(slotToLocalParts(13, AR), { dayIdx: 0, hour: 10 });
  // Slot 1 (Lunes 01:00 UTC) visto desde Argentina = Domingo 22:00
  assert.deepEqual(slotToLocalParts(1, AR), { dayIdx: 6, hour: 22 });
  // Slot 166 (Domingo 22:00 UTC) visto desde UTC+2 = Lunes 00:00
  assert.deepEqual(slotToLocalParts(166, EU2), { dayIdx: 0, hour: 0 });
});

test('computeSlotSets: vincula reglas por nombre sin distinguir mayúsculas', () => {
  const members = [{ email: 'ana@x.com', name: 'Ana Pérez', tz: 'UTC' }];
  const avails = [{ user: 'ana pérez', dayIdx: 2, startHour: 9, endHour: 10 }];
  const sets = computeSlotSets(members, avails);
  assert.deepEqual([...sets.get('ana@x.com')], [2 * 24 + 9]);
});

test('heatmap: lo que la persona marca en su grilla aparece EXACTO en sus celdas', () => {
  // Propiedad de ida y vuelta: para zonas con offset entero, el mapa visto en
  // la MISMA zona en que se marcó debe pintar exactamente esas celdas.
  const marked = [
    { dayIdx: 1, startHour: 10, endHour: 12 }, // Martes 10–12
    { dayIdx: 6, startHour: 22, endHour: 24 }  // Domingo 22–24 (borde de semana)
  ];
  for (const tz of ['UTC', AR, CO, 'America/Mexico_City', EU2]) {
    const member = { email: 'solo@x.com', name: 'Solo', tz, active: true };
    const avails = marked.map(r => ({ user: 'Solo', ...r }));
    const { grid } = buildHeatmapGrid([member], avails, tz);
    const expected = new Set(['1:10', '1:11', '6:22', '6:23']);
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const want = expected.has(`${d}:${h}`) ? 1 : 0;
        assert.equal(grid[d][h].count, want, `tz=${tz} celda ${d}:${h}`);
      }
    }
  }
});

test('heatmap: un solo miembro activo también se pinta (sala de 1 persona)', () => {
  const member = { email: 'uno@x.com', name: 'Uno', tz: AR };
  const avails = [{ user: 'Uno', dayIdx: 0, startHour: 9, endHour: 10 }];
  const { grid } = buildHeatmapGrid([member], avails, AR);
  assert.equal(grid[0][9].count, 1);
  assert.equal(grid[0][9].names, 'Uno');
});

test('heatmap: vista cruzada entre zonas (lo que marca AR lo ve Europa corrido)', () => {
  // Domingo 22:00 en Argentina = Lunes 03:00 en UTC+2
  const member = { email: 'ar@x.com', name: 'Ari', tz: AR };
  const avails = [{ user: 'Ari', dayIdx: 6, startHour: 22, endHour: 23 }];
  const { grid } = buildHeatmapGrid([member], avails, EU2);
  assert.equal(grid[0][3].count, 1);
});

test('heatmap: miembro con reglas duplicadas cuenta UNA sola vez por celda', () => {
  const member = { email: 'dup@x.com', name: 'Dup', tz: 'UTC' };
  const avails = [
    { user: 'Dup', dayIdx: 0, startHour: 10, endHour: 11 },
    { user: 'Dup', dayIdx: 0, startHour: 10, endHour: 11 } // fila fantasma
  ];
  const { grid } = buildHeatmapGrid([member], avails, 'UTC');
  assert.equal(grid[0][10].count, 1);
  assert.equal(grid[0][10].names, 'Dup');
});
