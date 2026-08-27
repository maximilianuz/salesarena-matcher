// Contenido de referencia de "Análisis de Llamada": las 6 fases del checklist
// universal de closing, los tipos de nota, el checklist técnico, el iceberg
// del Descubrimiento, las capas de observación (Palabras/Voz/Cuerpo/Imagen) y
// los 4 colores de personalidad.
//
// Portado tal cual del prototipo standalone (Analisis-de-Llamada.html, del
// sistema "Gimnasio de Closing") para que el contenido pedagógico sea
// idéntico entre ambas versiones. Vive en su propio archivo (no adentro de
// CallAnalysisView.jsx) porque es texto largo y estático — separarlo evita
// que el componente se vuelva ilegible por el volumen de contenido, no de
// lógica.

export const FASES = [
  {
    id: 'quimica', n: 'Química', alt: 'Rapport · Apertura · Conexión',
    pasa: 'Los primeros minutos. Se saludan, charlan de algo liviano. El prospecto decide si confía o no.',
    mirar: '¿El prospecto se soltó o se quedó tenso? ¿El closer sonó natural o forzado? ¿Duró muy poco (frío) o demasiado (se perdió el foco)?',
    bien: 'El prospecto habla suelto y sin apuro.'
  },
  {
    id: 'marco', n: 'Marco', alt: 'Encuadre · Frame · Setup',
    pasa: 'El closer explica cuánto dura, qué van a hacer, y que al final habrá un sí o un no — nunca un «lo pienso».',
    mirar: '¿Lo dijo o lo salteó? ¿El prospecto aceptó en voz alta?',
    bien: 'El prospecto dice «dale, perfecto» — hay acuerdo dicho, no silencio.'
  },
  {
    id: 'descubrimiento', n: 'Descubrimiento', alt: 'Discovery · Diagnóstico',
    pasa: 'La parte más importante. Preguntar y escuchar para entender el problema real, no el que dice al principio.',
    mirar: 'Usá el Iceberg y P.A.R.A. ¿Hasta qué nivel llegó? ¿Quién habló más?',
    bien: 'El prospecto contó algo que no tenía pensado contar.'
  },
  {
    id: 'transicion', n: 'Transición', alt: 'Puente · Bridge · Recap',
    pasa: 'El closer resume lo que entendió y pide permiso para mostrar la solución.',
    mirar: '¿Resumió con las palabras del prospecto o con las suyas? ¿Pidió permiso o arrancó a vender solo?',
    bien: 'El prospecto confirma el resumen («sí, exacto») antes del pitch.'
  },
  {
    id: 'pitch', n: 'Pitch', alt: 'Presentación · Oferta',
    pasa: 'Se presenta la oferta y el precio.',
    mirar: '¿Conectó cada parte con algo que el prospecto dijo antes, o recitó lo de siempre? ¿Dijo el precio con seguridad o lo escondió?',
    bien: 'El prospecto pregunta detalles del «cómo», no del «por qué».'
  },
  {
    id: 'cierre', n: 'Cierre', alt: 'Closing · Manejo de objeciones',
    pasa: 'Se pide la decisión y se manejan las objeciones que aparecen.',
    mirar: '¿Pidió la decisión de forma clara o se quedó esperando? ¿Se quedó callado después de preguntar?',
    bien: 'Hay un sí, un no, o un próximo paso con fecha y hora — nunca un «te aviso».'
  }
];

export const TIPOS = [
  { id: 'funciono', n: 'Funcionó', c: '#10b981' },
  { id: 'mejorar', n: 'A mejorar', c: '#f0b429' },
  { id: 'objecion', n: 'Objeción', c: '#ef6b6b' },
  { id: 'tecnico', n: 'Técnico', c: '#6fa8ff' },
  { id: '', n: 'Sin clasificar', c: '#7d8aa0' }
];

export const tipoOf = (id) => TIPOS.find(x => x.id === (id || '')) || TIPOS[4];

export const TEC = [
  { id: 'puntualidad', t: 'Puntualidad', d: '¿Empezó a horario? ¿Quién esperó a quién?' },
  { id: 'audio', t: 'Audio, video y entorno', d: '¿Se ve y se escucha bien de los dos lados? ¿Hubo ruido o cortes?' },
  { id: 'decide', t: 'Quién decide', d: '¿Se confirmó que el prospecto decide solo, o hay socio/pareja?' },
  { id: 'plata', t: 'Plata', d: '¿Se habló del presupuesto real y de cómo lo pagaría?' },
  { id: 'urgencia', t: 'Urgencia', d: '¿Quedó claro por qué ahora y no en seis meses?' },
  { id: 'precio', t: 'Momento del precio', d: '¿En qué minuto apareció? ¿Antes o después de que viera el valor?' },
  { id: 'tiempos', t: 'Reparto del tiempo', d: '¿Cuánto se llevó cada fase? ¿Alguna se comió a las demás?' },
  { id: 'paso', t: 'Próximo paso', d: '¿Quedó con fecha y hora concreta, o en el aire?' }
];

export const ICE = [
  { id: 'situacion', n: '1. Situación', q: '¿Qué está ocurriendo actualmente?', c: '#3b82f6' },
  { id: 'problema', n: '2. Problema', q: '¿Qué no está funcionando?', c: '#2f6fd6' },
  { id: 'impacto', n: '3. Impacto', q: '¿Cómo afecta esto su vida, negocio o futuro?', c: '#4f46e5' },
  { id: 'significado', n: '4. Significado', q: '¿Qué representa esta situación para esa persona?', c: '#3d3593' },
  { id: 'motivacion', n: '5. Motivación', q: '¿Por qué realmente quiere cambiar?', c: '#10b981' }
];

export const CAPAS = [
  {
    n: 'Palabras', s: 'lo que dice', c: '#4338ca', items: [
      ['Quién habla más', 'En Descubrimiento el prospecto debería hablar más que el closer.'],
      ['Preguntas abiertas vs. cerradas', '¿Cuántas de cada una, y en qué fase las usa?'],
      ['Palabras del prospecto', '¿El closer repite sus palabras exactas o impone las propias?'],
      ['Muletillas', '¿Aparecen y en qué momento? Suelen marcar nervios o duda.']
    ]
  },
  {
    n: 'Voz', s: 'cómo lo dice', c: '#6d28d9', items: [
      ['Ritmo', '¿Rápido (ansiedad o entusiasmo) o lento (duda o calma)?'],
      ['Volumen y energía', '¿Sube, baja o se apaga en algún momento puntual?'],
      ['Silencios', '¿Se sostienen a propósito o se llenan enseguida por nervios?'],
      ['Final de frase', '¿Sube como pregunta insegura o baja como afirmación firme? Clave al decir el precio.']
    ]
  },
  {
    n: 'Cuerpo', s: 'lo que el cuerpo dice', c: '#0e7490', items: [
      ['Postura', '¿Se inclina hacia adelante (interés) o hacia atrás (distancia)?'],
      ['Mirada', '¿Sostiene la cámara, o mira a otro lado justo en el tema importante?'],
      ['Manos', '¿Abiertas y visibles (cómodo) o cerradas/cruzadas (a la defensiva)?'],
      ['Cara', '¿La expresión coincide con lo que dice? Si dice «sí» y la cara dice «no», eso es una observación.']
    ]
  },
  {
    n: 'Imagen', s: 'lo que se ve antes de hablar', c: '#57534e', items: [
      ['Colores y estilo de ropa', '¿Fuerte y funcional, vivo y llamativo, cómodo y simple, o formal y neutro?'],
      ['Entorno', '¿Ordenado o desordenado? ¿Dice algo de cómo trabaja?'],
      ['Detalles', '¿Hay algo que llame la atención?'],
      ['Para qué sirve', 'Es la primera pista del color de personalidad — nunca la respuesta final.']
    ]
  }
];

export const COLORES = [
  {
    n: 'Rojo', t: 'directo · decisivo · resultados', c: '#b13c30', items: [
      ['Señales', 'Va al grano, mide el tiempo, quiere el dato o el resultado ya.'],
      ['Imagen', 'Funcional y prolija, colores fuertes o sobrios, pocos accesorios.'],
      ['Voz', 'Firme, rápida, frases cortas, interrumpe si te enredás.'],
      ['Objeción', 'Respondé sin rodeos, con datos, sin dramatizar.'],
      ['Para cerrar', 'Directo, con propósito y urgencia real — nada de vueltas.']
    ]
  },
  {
    n: 'Amarillo', t: 'entusiasta · creativo · vínculo', c: '#8a5e0f', items: [
      ['Señales', 'Cambia el ambiente al entrar, cuenta historias, se dispersa del guion.'],
      ['Imagen', 'Colores vivos, algo llamativo o distinto, accesorios.'],
      ['Voz', 'Expresiva, cambia de tono, se ríe, se entusiasma.'],
      ['Objeción', 'Validá primero lo bueno, después lo mejorable; clima liviano.'],
      ['Para cerrar', 'Contagiá entusiasmo — si vos no lo ves emocionante, él tampoco.']
    ]
  },
  {
    n: 'Verde', t: 'calmado · leal · estable', c: '#3f7a52', items: [
      ['Señales', 'Escucha más de lo que habla, evita el protagonismo, no confronta.'],
      ['Imagen', 'Colores suaves, ropa cómoda e informal, nada que llame la atención.'],
      ['Voz', 'Pausada, volumen bajo, silencios largos antes de responder.'],
      ['Objeción', 'Con calma y sin juicio; preguntale cómo se siente antes de argumentar.'],
      ['Para cerrar', 'Mostrale que esto no le suma presión, caos ni inestabilidad.']
    ]
  },
  {
    n: 'Azul', t: 'analítico · preciso · estructurado', c: '#2d5a8a', items: [
      ['Señales', 'Pide contexto y datos antes de decidir, quiere el paso a paso claro.'],
      ['Imagen', 'Formal o muy prolija, colores neutros, todo combinado.'],
      ['Voz', 'Medida, precisa, sin exageraciones; corrige detalles.'],
      ['Objeción', 'Datos y ejemplos concretos, tono formal, sin dramatizar.'],
      ['Para cerrar', 'Casos reales, cifras y plan de contingencia — nunca solo una opinión.']
    ]
  }
];

export const fmtT = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

export const tituloAnalisis = (a) => {
  const m = (a && a.meta) || {};
  return (m.closer ? ('Closer: ' + m.closer) : 'Análisis sin nombre') + (m.rubro ? (' · ' + m.rubro) : '');
};

export const blankMeta = () => ({
  fecha: new Date().toISOString().slice(0, 10),
  closer: '', rubro: '', origen: '', necesita: '', producto: '', duracion: '', resultado: ''
});
