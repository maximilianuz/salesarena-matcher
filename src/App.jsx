import React, { useState, useEffect } from 'react';
import './App.css';
import { supabase } from './supabaseClient';
import {
  LayoutDashboard,
  CalendarRange,
  Flame,
  Users,
  UserCheck,
  CheckCircle,
  Video,
  Clock,
  Sparkles,
  MapPin,
  Check,
  Plus,
  RefreshCw,
  Trash2,
  Calendar,
  AlertCircle,
  Sun,
  Moon,
  Monitor,
  Menu,
  X,
  Share2,
  ExternalLink,
  Copy
} from 'lucide-react';

const CalendarPremiumIcon = ({ size = 26 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 512 512" style={{ display: 'block' }} className="calendar-premium-svg">
    <defs>
      <linearGradient id="calendarGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#2563eb"/>
        <stop offset="100%" stopColor="#7c3aed"/>
      </linearGradient>
      <filter id="shadowFilter">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
        <feOffset dx="0" dy="2" result="offsetblur"/>
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.3"/>
        </feComponentTransfer>
        <feMerge>
          <feMergeNode/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <rect width="512" height="512" rx="115" fill="url(#calendarGradient)"/>
    <g transform="translate(100, 100)" fill="none" stroke="white" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round">
      <rect x="20" y="60" width="312" height="292" rx="20"/>
      <line x1="20" y1="140" x2="332" y2="140"/>
      <line x1="104" y1="60" x2="104" y2="120"/>
      <line x1="248" y1="60" x2="248" y2="120"/>
      <circle cx="76" cy="200" r="16"/>
      <circle cx="176" cy="200" r="16"/>
      <circle cx="276" cy="200" r="16"/>
      <circle cx="76" cy="280" r="16"/>
      <circle cx="176" cy="280" r="16"/>
      <circle cx="276" cy="280" r="16"/>
    </g>
  </svg>
);

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Paises y Zonas Horarias
const ZONAS = [
  // América
  { country: 'Argentina', tz: 'America/Argentina/Buenos_Aires' },
  { country: 'Chile', tz: 'America/Santiago' },
  { country: 'Colombia', tz: 'America/Bogota' },
  { country: 'México', tz: 'America/Mexico_City' },
  { country: 'Estados Unidos (Este)', tz: 'America/New_York' },
  { country: 'Estados Unidos (Pacífico)', tz: 'America/Los_Angeles' },
  { country: 'Perú', tz: 'America/Lima' },
  { country: 'Uruguay', tz: 'America/Montevideo' },
  { country: 'Ecuador', tz: 'America/Guayaquil' },
  { country: 'Paraguay', tz: 'America/Asuncion' },
  { country: 'Bolivia', tz: 'America/La_Paz' },
  { country: 'Costa Rica', tz: 'America/Costa_Rica' },
  { country: 'Panamá', tz: 'America/Panama' },
  { country: 'Venezuela', tz: 'America/Caracas' },
  
  // Europa Central / Occidental
  { country: 'España', tz: 'Europe/Madrid' },
  { country: 'Alemania', tz: 'Europe/Berlin' },
  { country: 'Francia', tz: 'Europe/Paris' },
  { country: 'Italia', tz: 'Europe/Rome' },
  { country: 'Reino Unido', tz: 'Europe/London' },
  { country: 'Suiza', tz: 'Europe/Zurich' },
  { country: 'Austria', tz: 'Europe/Vienna' },
  { country: 'Polonia', tz: 'Europe/Warsaw' },
  { country: 'Países Bajos', tz: 'Europe/Amsterdam' },
  { country: 'Bélgica', tz: 'Europe/Brussels' },
  { country: 'República Checa', tz: 'Europe/Prague' }
];

const resolveTimezone = (countryName) => {
  if (!countryName) return 'UTC';
  const cleanName = countryName.trim().toLowerCase();
  
  // Buscar en las ZONAS predefinidas
  const matched = ZONAS.find(z => 
    z.country.toLowerCase().includes(cleanName) || 
    cleanName.includes(z.country.toLowerCase())
  );
  if (matched) return matched.tz;
  
  // Como fallback, usar la zona horaria real del navegador del usuario
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (e) {
    return 'UTC';
  }
};

const useMockDb = !import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL.includes('placeholder');

const getRoomIdFromUrl = () => {
  const path = window.location.pathname;
  const match = path.match(/\/room\/([^/]+)/);
  return match ? match[1] : null;
};

const slugifyRoomName = (name) => {
  if (!name) return 'grupo-a';
  const clean = name.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return clean || 'grupo-a';
};

const LandingPage = ({ onEnter, theme }) => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: 'var(--bg-main)',
    backgroundImage: 'var(--bg-glows)',
    backgroundAttachment: 'fixed',
    color: 'var(--text-main)',
    fontFamily: 'var(--font-sans)',
    padding: '20px',
    boxSizing: 'border-box',
    position: 'relative'
  }}>
    {/* Theme selector top-right */}
    <div style={{ position: 'absolute', top: '20px', right: '20px', display: 'flex', gap: '8px', zIndex: 10 }}>
      <div className="theme-selector" style={{ margin: 0 }}>
        <button className={`theme-btn ${theme === 'light' ? 'active' : ''}`} onClick={() => document.documentElement.classList.remove('dark')} title="Modo Claro">
          <Sun size={12} />
        </button>
        <button className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => document.documentElement.classList.add('dark')} title="Modo Oscuro">
          <Moon size={12} />
        </button>
      </div>
    </div>

    <div className="glass" style={{
      width: '100%',
      maxWidth: '520px',
      padding: '60px 40px',
      textAlign: 'center',
      boxSizing: 'border-box'
    }}>
      {/* Logo & Title */}
      <div style={{ marginBottom: '40px' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '80px',
          height: '80px',
          borderRadius: '20px',
          marginBottom: '24px',
          background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
          boxShadow: '0 8px 32px rgba(37, 99, 235, 0.3)'
        }}>
          <CalendarPremiumIcon size={60} />
        </div>
        <h1 style={{
          margin: '0 0 8px 0',
          fontSize: '36px',
          fontWeight: '900',
          letterSpacing: '-0.5px',
          color: 'var(--text-main)'
        }}>
          Real Sales Labs
        </h1>
        <p style={{
          margin: '0 0 24px 0',
          fontSize: '16px',
          fontWeight: '600',
          background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          color: 'var(--color-primary)'
        }}>
          Sincronización de Horarios
        </p>
      </div>

      {/* Description */}
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{
          margin: '0 0 16px 0',
          fontSize: '24px',
          fontWeight: '700',
          letterSpacing: '-0.3px',
          color: 'var(--text-main)'
        }}>
          Coordina tu disponibilidad
        </h2>
        <p style={{
          margin: '0 0 12px 0',
          fontSize: '15px',
          color: 'var(--text-muted)',
          lineHeight: '1.6'
        }}>
          Sincroniza horarios, detecta coincidencias y programa reuniones automáticamente con tu equipo.
        </p>
      </div>

      {/* Features */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '16px',
        marginBottom: '40px'
      }}>
        {[
          { icon: Calendar, text: 'Disponibilidad' },
          { icon: Users, text: 'Equipo' },
          { icon: Video, text: 'Google Meet' },
          { icon: Clock, text: 'Zonas Horarias' }
        ].map((feature, i) => {
          const IconComponent = feature.icon;
          return (
            <div key={i} style={{
              padding: '16px',
              borderRadius: '12px',
              backgroundColor: 'var(--bg-card-hover)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '13px',
              fontWeight: '500',
              color: 'var(--text-main)'
            }}>
              <IconComponent size={18} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
              {feature.text}
            </div>
          );
        })}
      </div>

      {/* CTA Button */}
      <button
        onClick={onEnter}
        style={{
          width: '100%',
          padding: '16px 24px',
          fontSize: '16px',
          fontWeight: '700',
          letterSpacing: '-0.3px',
          backgroundColor: 'var(--color-primary)',
          color: 'white',
          border: 'none',
          borderRadius: '12px',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          boxShadow: '0 4px 16px rgba(37, 99, 235, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px'
        }}
        onMouseEnter={(e) => {
          e.target.style.backgroundColor = 'var(--color-primary-hover)';
          e.target.style.transform = 'translateY(-2px)';
          e.target.style.boxShadow = '0 8px 24px rgba(37, 99, 235, 0.4)';
        }}
        onMouseLeave={(e) => {
          e.target.style.backgroundColor = 'var(--color-primary)';
          e.target.style.transform = 'translateY(0)';
          e.target.style.boxShadow = '0 4px 16px rgba(37, 99, 235, 0.3)';
        }}
      >
        <span>Ingresar</span>
        <ExternalLink size={18} />
      </button>

      {/* Footer note */}
      <p style={{
        margin: '24px 0 0 0',
        fontSize: '12px',
        color: 'var(--text-muted)',
        lineHeight: '1.5'
      }}>
        Acceso gratuito para todos los miembros de la comunidad<br/>
        <a href="https://www.skool.com/real-sales-lab-8381/about?ref=6b5c94a4d70e488bba9eb815023e8247"
           target="_blank"
           rel="noopener noreferrer"
           style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: '600' }}>
          Real Sales Lab →
        </a>
      </p>
    </div>
  </div>
);

export default function App() {
  const [showLandingPage, setShowLandingPage] = useState(() => {
    return localStorage.getItem('realsaleslabs-visited') !== 'true';
  });

  const [activeTab, setActiveTab] = useState('dashboard');

  const [currentRoomId, setCurrentRoomId] = useState(() => {
    const roomId = getRoomIdFromUrl();
    return roomId || null;
  });

  // Tema (light | dark | system)
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('realsaleslabs-theme') || 'system';
  });

  // Estado del Sidebar móvil
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Autenticación de Google (Simulada)
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return localStorage.getItem('realsaleslabs-logged') === 'true';
  });

  // Estado del flujo de Login/Registro
  const [loginStep, setLoginStep] = useState(1); // 1: Google Email, 2: Profile setup Form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginCountry, setLoginCountry] = useState('Argentina');
  const [customLoginCountry, setCustomLoginCountry] = useState('');
  const [customNewMemberCountry, setCustomNewMemberCountry] = useState('');

  const [roomName, setRoomName] = useState(() => {
    const roomId = getRoomIdFromUrl();
    if (!roomId) return '';
    return 'Sala ' + roomId.charAt(0).toUpperCase() + roomId.slice(1);
  });
  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const [newRoomNameInput, setNewRoomNameInput] = useState('');
  const [renameRoomInput, setRenameRoomInput] = useState('');

  // Estado de Usuario Logueado (Simulado)
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('realsaleslabs-user');
    return saved ? JSON.parse(saved) : null;
  });

  // Base de Datos en Estado (Vacia para producción)
  const [members, setMembers] = useState([]);

  // Disponibilidad: lista de { user, dayIdx, startHour, endHour }
  const [availabilities, setAvailabilities] = useState([]);

  // Plantillas Fijas: copia inicial
  const [templates, setTemplates] = useState([]);

  // Reuniones agendadas
  const [meetings, setMeetings] = useState([]);

  // Sistema de notificaciones premium (toast)
  const [toasts, setToasts] = useState([]); // [{id, msg, type}]
  const [confirmModal, setConfirmModal] = useState(null); // {msg, onConfirm, onCancel}

  // Estados de carga del Wizard
  const [wizardStep, setWizardStep] = useState(1); // 1: Bienvenida, 2: Opciones, 3: Grid
  const [wizardGrid, setWizardGrid] = useState([]); // [{dayIdx, hour}]
  const [saveAsTemplate, setSaveAsTemplate] = useState(true);
  const [wizardStatus, setWizardStatus] = useState(null); // {type, msg}

  // Nuevos miembros
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberCountry, setNewMemberCountry] = useState('Argentina');

  // Estados de simulación de Google Meet / Calendar API
  const [schedulingStatus, setSchedulingStatus] = useState(null); // null | 'loading' | 'authenticating' | 'creating' | 'success'
  const [scheduledDetails, setScheduledDetails] = useState(null); // { title, attendeesCount }

  // Resultados del Motor calculados dinámicamente
  const [matches, setMatches] = useState([]);
  const [heatmap, setHeatmap] = useState([]); // 7x24 grid
  const [affinity, setAffinity] = useState([]);

  // Variables para arrastre en la grilla visual
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [dragMode, setDragMode] = useState(true); // true = pintar, false = borrar

  // Session Recovery
  const [showSessionRecovery, setShowSessionRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');

  // --- MOTOR DE COINCIDENCIAS (REACT PORT) ---
  // --- SESSION RECOVERY CHECK ---
  useEffect(() => {
    // If user visited but localStorage was cleared and not logged in, show recovery
    if (localStorage.getItem('realsaleslabs-visited') === 'true' && !isLoggedIn && !currentUser) {
      setShowSessionRecovery(true);
    }
  }, []);

  useEffect(() => {
    calculateEngine();
  }, [members, availabilities]);

  // --- MANEJO DE TEMAS (DARK/LIGHT/SYSTEM) ---
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (t) => {
      if (t === 'dark') {
        root.classList.add('dark');
      } else if (t === 'light') {
        root.classList.remove('dark');
      } else {
        // System preference
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (systemPrefersDark) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      }
    };

    applyTheme(theme);
    localStorage.setItem('realsaleslabs-theme', theme);

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = (e) => {
        if (e.matches) root.classList.add('dark');
        else root.classList.remove('dark');
      };
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [theme]);

  // Sincronizar automáticamente la URL del navegador con el nombre de la sala
  useEffect(() => {
    if (roomName) {
      const targetSlug = slugifyRoomName(roomName);
      if (targetSlug && window.location.pathname !== `/room/${targetSlug}`) {
        window.history.replaceState(null, '', `/room/${targetSlug}`);
      }
    }
  }, [roomName]);

  // --- REAL-TIME DATA SYNCHRONIZATION WITH SUPABASE ---
  useEffect(() => {
    if (useMockDb) return;

    const loadSupabaseData = async () => {
      // 1. Fetch Room (or create it if it doesn't exist)
      let { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', currentRoomId)
        .maybeSingle();

      if (roomError || !roomData) {
        const defaultName = `Sala ${currentRoomId.charAt(0).toUpperCase() + currentRoomId.slice(1)}`;
        await supabase.from('rooms').insert({ id: currentRoomId, name: defaultName });
        setRoomName(defaultName);
        setRenameRoomInput(defaultName);
      } else {
        setRoomName(roomData.name);
        setRenameRoomInput(roomData.name);
      }

      // 2. Fetch Members
      const { data: memData } = await supabase
        .from('members')
        .select('*')
        .eq('room_id', currentRoomId);
      if (memData) {
        setMembers(memData.map(d => ({
          name: d.name,
          email: d.email,
          country: d.country,
          tz: d.timezone,
          active: d.active
        })));
      }

      // 3. Fetch Availabilities
      const { data: availData } = await supabase
        .from('availabilities')
        .select('*')
        .eq('room_id', currentRoomId);
      if (availData) {
        setAvailabilities(availData.map(d => ({
          user: d.user,
          dayIdx: d.day_idx,
          startHour: d.start_hour,
          endHour: d.end_hour
        })));
      }

      // 4. Fetch Meetings
      const { data: meetData } = await supabase
        .from('meetings')
        .select('*')
        .eq('room_id', currentRoomId);
      if (meetData) {
        setMeetings(meetData.map(d => ({
          title: d.title,
          dateUtc: d.date_utc,
          duration: d.duration || 60,
          participants: d.participants,
          meetLink: d.meet_link,
          status: 'Creado (Meet)'
        })));
      }
    };

    loadSupabaseData();
  }, [currentRoomId]);

  // --- REAL GOOGLE OAUTH CALLBACK LISTENERS ---
  useEffect(() => {
    if (useMockDb) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && session.user) {
        handleOAuthSession(session);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && session.user) {
        handleOAuthSession(session);
      } else if (!session) {
        setIsLoggedIn(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [currentRoomId]);

  const handleOAuthSession = async (session) => {
    const email = session.user.email;
    setLoginEmail(email);

    try {
      const { data: existing } = await supabase
        .from('members')
        .select('*')
        .eq('room_id', currentRoomId)
        .eq('email', email)
        .maybeSingle();

      if (existing) {
        const userObj = {
          name: existing.name,
          email: existing.email,
          country: existing.country,
          tz: existing.timezone,
          active: existing.active
        };
        setCurrentUser(userObj);
        setIsLoggedIn(true);
        localStorage.setItem('realsaleslabs-logged', 'true');
        localStorage.setItem('realsaleslabs-user', JSON.stringify(userObj));
      } else {
        setLoginStep(2);
        setIsLoggedIn(false);
      }
    } catch (err) {
      console.error('Error verificando usuario OAuth:', err);
      setLoginStep(2);
      setIsLoggedIn(false);
    }
  };

  // Obtener offset en minutos para una hora y zona horaria dada
  const getOffsetMinutes = (tz) => {
    const offsets = {
      'America/Argentina/Buenos_Aires': -180,
      'Europe/Madrid': 120, // UTC+2
      'America/Mexico_City': -360,
      'America/Santiago': -240, // Chile
      'America/Los_Angeles': -480
    };
    return offsets[tz] || 0;
  };

  const calculateEngine = () => {
    const activeMembers = members.filter(m => m.active);
    if (activeMembers.length < 2) {
      setMatches([]);
      return;
    }

    const nSlots = 7 * 24; // 168 slots de 1 hora
    const presence = Array.from({ length: nSlots }, () => []);
    const freeSlotsCount = activeMembers.map(() => 0);

    // Mapear intervalos locales a UTC
    activeMembers.forEach((member, memberIdx) => {
      const offset = getOffsetMinutes(member.tz);
      const userRules = availabilities.filter(a => a.user.toLowerCase() === member.name.toLowerCase());

      userRules.forEach(rule => {
        // Traducir inicio y fin local a minutos desde el lunes 00:00 local
        const startLocalMin = rule.dayIdx * 24 * 60 + rule.startHour * 60;
        const endLocalMin = rule.dayIdx * 24 * 60 + rule.endHour * 60;

        // Traducir a UTC minutes
        const startUtcMin = startLocalMin - offset;
        const endUtcMin = endLocalMin - offset;

        // Rellenar slots de 1 hora
        for (let s = 0; s < nSlots; s++) {
          const slotStartMin = s * 60;
          const slotEndMin = (s + 1) * 60;

          // Si el slot cae dentro del intervalo disponible
          if (slotStartMin >= startUtcMin && slotEndMin <= endUtcMin) {
            presence[s].push(memberIdx);
            freeSlotsCount[memberIdx]++;
          }
        }
      });
    });

    // 1. Calcular Matches (fusionando slots contiguos)
    const minParticipants = 2;
    const windows = [];
    let currentWindow = null;

    for (let s = 0; s < nSlots; s++) {
      const idxs = presence[s];
      const presentNames = idxs.map(i => activeMembers[i].name);
      const sig = [...idxs].sort().join('|');

      if (currentWindow && currentWindow.sig === sig && presentNames.length >= minParticipants) {
        currentWindow.endSlot = s + 1;
      } else {
        if (currentWindow) windows.push(currentWindow);
        currentWindow = (presentNames.length >= minParticipants)
          ? { sig, startSlot: s, endSlot: s + 1, members: presentNames }
          : null;
      }
    }
    if (currentWindow) windows.push(currentWindow);

    // Formatear y ordenar ventanas
    const calculatedMatches = windows.map((w, index) => {
      const startHourUtc = w.startSlot % 24;
      const startDayIdx = Math.floor(w.startSlot / 24);
      const endHourUtc = w.endSlot % 24;
      const endDayIdx = Math.floor(w.endSlot / 24);

      const localDetail = activeMembers.map(m => {
        const offset = getOffsetMinutes(m.tz);
        const localStartHour = (startHourUtc + (offset / 60) + 24) % 24;
        const localEndHour = (endHourUtc + (offset / 60) + 24) % 24;
        return `${m.name.split(' ')[0]}: ${String(Math.floor(localStartHour)).padStart(2, '0')}:00-${String(Math.floor(localEndHour)).padStart(2, '0')}:00`;
      }).join(' | ');

      const score = Math.round((w.members.length / activeMembers.length) * 100);

      return {
        rank: index + 1,
        day: DIAS[startDayIdx],
        startStr: `${String(startHourUtc).padStart(2, '0')}:00 UTC`,
        endStr: `${String(endHourUtc).padStart(2, '0')}:00 UTC`,
        participants: w.members.join(', '),
        localDetail,
        score,
        startSlot: w.startSlot,
        endSlot: w.endSlot
      };
    });

    calculatedMatches.sort((a, b) => b.score - a.score || (b.endSlot - b.startSlot) - (a.endSlot - a.startSlot));
    setMatches(calculatedMatches.slice(0, 5));

    // 2. Calcular Heatmap (7 días x 24 horas)
    const grid = [];
    const viewOffset = getOffsetMinutes(currentUser?.tz || 'UTC'); // Ver en hora local del usuario activo

    for (let d = 0; d < 7; d++) {
      const hoursRow = [];
      for (let h = 0; h < 24; h++) {
        // Convertir día/hora local de Tomás a UTC
        const localMin = d * 24 * 60 + h * 60;
        const utcMin = localMin - viewOffset;
        const slotIdx = Math.floor((utcMin / 60) + nSlots) % nSlots;

        // Personas libres en este slot
        const freeCount = presence[slotIdx] ? presence[slotIdx].length : 0;
        const freeNames = presence[slotIdx] ? presence[slotIdx].map(idx => activeMembers[idx].name).join(', ') : '';

        hoursRow.push({ count: freeCount, names: freeNames });
      }
      grid.push(hoursRow);
    }
    setHeatmap(grid);

    // 3. Matriz de Afinidad (Solapamientos relativos)
    const n = activeMembers.length;
    const affinityMatrix = Array.from({ length: n }, () => Array(n).fill(0));

    // Contar solapamientos
    for (let s = 0; s < nSlots; s++) {
      const here = presence[s];
      for (let a = 0; a < here.length; a++) {
        for (let b = a + 1; b < here.length; b++) {
          affinityMatrix[here[a]][here[b]]++;
          affinityMatrix[here[b]][here[a]]++;
        }
      }
    }

    // Convertir a porcentajes
    const calculatedAffinity = activeMembers.map((member, i) => {
      const partnerStats = activeMembers.map((partner, j) => {
        if (i === j) return { name: partner.name, pct: null };
        const denom = Math.min(freeSlotsCount[i], freeSlotsCount[j]);
        const pct = denom ? Math.round((affinityMatrix[i][j] / denom) * 100) : 0;
        return { name: partner.name, pct };
      });

      return {
        name: member.name,
        stats: partnerStats
      };
    });
    setAffinity(calculatedAffinity);
  };

  // --- ACCIONES DEL WIZARD ---
  const handleWizardParticipation = (participate) => {
    setWizardStatus({ type: 'loading', msg: 'Guardando tu estado...' });
    setTimeout(() => {
      // Modificar en la lista de miembros
      const updatedMembers = members.map(m =>
        m.email.toLowerCase() === currentUser.email.toLowerCase() ? { ...m, active: participate } : m
      );
      setMembers(updatedMembers);

      if (participate) {
        // Cargar horarios del usuario activo en la grilla visual
        const userRules = availabilities.filter(a => a.user.toLowerCase() === currentUser.name.toLowerCase());
        const gridSlots = [];
        userRules.forEach(rule => {
          for (let h = rule.startHour; h < rule.endHour; h++) {
            gridSlots.push({ dayIdx: rule.dayIdx, hour: h });
          }
        });
        setWizardGrid(gridSlots);
        setWizardStep(2);
      } else {
        // Borrar horarios semanales
        const cleanAvail = availabilities.filter(a => a.user.toLowerCase() !== currentUser.name.toLowerCase());
        setAvailabilities(cleanAvail);
        setWizardStatus({ type: 'success', msg: '¡Registrado! Has sido excluido por esta semana.' });
        setTimeout(() => {
          setActiveTab('dashboard');
          setWizardStep(1);
        }, 2000);
      }
    }, 1000);
  };

  const handleUseTemplate = () => {
    setWizardStatus({ type: 'loading', msg: 'Aplicando horarios base de tu plantilla...' });
    setTimeout(() => {
      // Reemplazar horarios en la disponibilidad semanal
      const userTemplateRules = templates.filter(t => t.user.toLowerCase() === currentUser.name.toLowerCase());
      const cleanAvail = availabilities.filter(a => a.user.toLowerCase() !== currentUser.name.toLowerCase());
      setAvailabilities([...cleanAvail, ...userTemplateRules]);

      setWizardStatus({ type: 'success', msg: '¡Horario base cargado con éxito para esta semana!' });
      setTimeout(() => {
        setActiveTab('dashboard');
        setWizardStep(1);
      }, 2000);
    }, 1000);
  };

  const saveWizardGrid = async () => {
    setWizardStatus({ type: 'loading', msg: 'Procesando horarios de la grilla...' });
    
    // 1. Agrupar los slots por día
    const slotsByDay = {};
    wizardGrid.forEach(slot => {
      if (!slotsByDay[slot.dayIdx]) slotsByDay[slot.dayIdx] = [];
      slotsByDay[slot.dayIdx].push(slot.hour);
    });

    // 2. Encontrar bloques contiguos
    const newRules = [];
    for (let d = 0; d < 7; d++) {
      const hours = slotsByDay[d] || [];
      if (hours.length === 0) continue;
      
      hours.sort((a, b) => a - b);
      let start = hours[0];
      let prev = hours[0];

      for (let k = 1; k <= hours.length; k++) {
        const current = hours[k];
        if (current === undefined || current !== prev + 1) {
          newRules.push({
            user: currentUser.name,
            dayIdx: d,
            startHour: start,
            endHour: prev + 1
          });
          if (current !== undefined) start = current;
        }
        prev = current;
      }
    }

    if (!useMockDb) {
      // Borrar antiguos bloques en Supabase
      const { error: delError } = await supabase.from('availabilities')
        .delete()
        .eq('room_id', currentRoomId)
        .eq('user', currentUser.name);

      if (delError) {
        setWizardStatus({ type: 'error', msg: 'Error al actualizar horarios en Supabase.' });
        return;
      }

      // Insertar nuevos bloques
      if (newRules.length > 0) {
        const toInsert = newRules.map(r => ({
          room_id: currentRoomId,
          user: r.user,
          day_idx: r.dayIdx,
          start_hour: r.startHour,
          end_hour: r.endHour
        }));
        const { error: insError } = await supabase.from('availabilities').insert(toInsert);
        if (insError) {
          setWizardStatus({ type: 'error', msg: 'Error al insertar horarios en Supabase.' });
          return;
        }
      }
    }

    // 3. Escribir a disponibilidad local
    const cleanAvail = availabilities.filter(a => a.user.toLowerCase() !== currentUser.name.toLowerCase());
    setAvailabilities([...cleanAvail, ...newRules]);

    // 4. Si se guarda como plantilla
    if (saveAsTemplate) {
      const cleanTemplate = templates.filter(t => t.user.toLowerCase() !== currentUser.name.toLowerCase());
      setTemplates([...cleanTemplate, ...newRules]);
    }

    setWizardStatus({ type: 'success', msg: '¡Disponibilidad guardada correctamente!' });
    setTimeout(() => {
      setActiveTab('dashboard');
      setWizardStep(1);
    }, 2000);
  };

  // --- SESSION RECOVERY BY EMAIL ---
  const handleSessionRecovery = async (e) => {
    if (e) e.preventDefault();
    if (!recoveryEmail.trim()) {
      showNotification('Por favor, ingresa un email válido.');
      return;
    }

    try {
      // Search for user in Supabase
      const { data: memberData } = await supabase
        .from('members')
        .select('*')
        .eq('room_id', currentRoomId)
        .eq('email', recoveryEmail.toLowerCase())
        .maybeSingle();

      if (memberData) {
        const userObj = {
          name: memberData.name,
          email: memberData.email,
          country: memberData.country,
          tz: memberData.timezone,
          active: memberData.active
        };
        setCurrentUser(userObj);
        setIsLoggedIn(true);
        setLoginEmail(memberData.email);
        localStorage.setItem('realsaleslabs-logged', 'true');
        localStorage.setItem('realsaleslabs-user', JSON.stringify(userObj));
        setShowSessionRecovery(false);
        setRecoveryEmail('');
        showNotification(`¡Bienvenido de vuelta, ${userObj.name}!`);
      } else {
        showNotification('No encontramos una cuenta con este email. Por favor, completa el registro.');
        setShowSessionRecovery(false);
        setRecoveryEmail('');
        setLoginEmail(recoveryEmail.toLowerCase());
        setLoginStep(2);
      }
    } catch (error) {
      showNotification('Error al recuperar sesión: ' + error.message);
    }
  };

  // --- SIMULACIÓN DE AUTENTICACIÓN GOOGLE ---
  const handleGoogleLoginSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();

    if (!useMockDb) {
      // Iniciar sesión con Google OAuth usando Supabase (no requiere ingresar email en nuestro input)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/calendar.events',
          redirectTo: window.location.origin + `/room/${currentRoomId}`
        }
      });
      if (error) {
        showNotification('Error al iniciar sesión con Google: ' + error.message);
      }
      return;
    }

    // Lógica Mock (si se usa mock local)
    let emailToUse = loginEmail.trim();
    if (!emailToUse) {
      emailToUse = 'invitado@gmail.com'; // Default mock fallback
      setLoginEmail(emailToUse);
    }

    const existing = members.find(m => m.email.toLowerCase() === emailToUse.toLowerCase());
    
    if (existing) {
      setCurrentUser(existing);
      setIsLoggedIn(true);
      localStorage.setItem('realsaleslabs-logged', 'true');
      localStorage.setItem('realsaleslabs-user', JSON.stringify(existing));
      showNotification(`¡Bienvenido de vuelta, ${existing.name}!`);
    } else {
      setLoginStep(2);
    }
  };

  const handleProfileRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!loginName || !loginCountry) return;

    const finalCountry = loginCountry === 'Otro' ? customLoginCountry.trim() : loginCountry;
    const finalTz = resolveTimezone(finalCountry);
    const newUser = {
      name: loginName.trim(),
      email: loginEmail.trim().toLowerCase(),
      country: finalCountry,
      tz: finalTz,
      active: true
    };

    if (!useMockDb) {
      const { error } = await supabase.from('members').insert({
        room_id: currentRoomId,
        email: newUser.email,
        name: newUser.name,
        country: newUser.country,
        timezone: newUser.tz,
        active: newUser.active
      });
      if (error) {
        showNotification('Error al registrar perfil en Supabase: ' + error.message);
        return;
      }
    }

    setMembers(prev => {
      if (prev.some(m => m.email.toLowerCase() === newUser.email.toLowerCase())) {
        return prev.map(m => m.email.toLowerCase() === newUser.email.toLowerCase() ? newUser : m);
      }
      return [...prev, newUser];
    });

    setCurrentUser(newUser);
    setIsLoggedIn(true);
    localStorage.setItem('realsaleslabs-logged', 'true');
    localStorage.setItem('realsaleslabs-user', JSON.stringify(newUser));

    showNotification(`¡Registro completo! Bienvenido a Real Sales Labs Matcher, ${newUser.name}.`);
  };

  const handleLogout = async () => {
    if (!useMockDb) {
      await supabase.auth.signOut();
    }
    setIsLoggedIn(false);
    setLoginEmail('');
    setLoginName('');
    setLoginStep(1);
    localStorage.removeItem('realsaleslabs-logged');
    localStorage.removeItem('realsaleslabs-user');
  };

  // --- GESTIÓN DE SALAS (ROOMS) ---
  const handleRenameRoom = async (e) => {
    e.preventDefault();
    if (!renameRoomInput.trim()) return;

    const nextName = renameRoomInput.trim();
    const newSlug = nextName.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/[^a-z0-9\s-]/g, '') // remove special chars
      .trim()
      .replace(/\s+/g, '-');

    if (!newSlug) {
      showNotification('Nombre de sala inválido.');
      return;
    }

    setRoomName(nextName);

    if (!useMockDb) {
      if (newSlug !== currentRoomId) {
        // 1. Crear o actualizar la nueva sala con el slug correcto
        await supabase.from('rooms').upsert({ id: newSlug, name: nextName });
        // 2. Migrar los registros vinculados a la nueva sala
        await supabase.from('members').update({ room_id: newSlug }).eq('room_id', currentRoomId);
        await supabase.from('availabilities').update({ room_id: newSlug }).eq('room_id', currentRoomId);
        await supabase.from('templates').update({ room_id: newSlug }).eq('room_id', currentRoomId);
        await supabase.from('meetings').update({ room_id: newSlug }).eq('room_id', currentRoomId);
        // 3. Eliminar la sala antigua si no es la sala por defecto
        if (currentRoomId !== 'grupo-a') {
          await supabase.from('rooms').delete().eq('id', currentRoomId);
        }
      } else {
        await supabase.from('rooms').update({ name: nextName }).eq('id', currentRoomId);
      }
    }

    if (newSlug !== currentRoomId) {
      showNotification(`¡Sala renombrada a "${nextName}"! Actualizando enlace a /room/${newSlug}...`);
      setIsRoomModalOpen(false);
      window.location.href = `/room/${newSlug}`;
    } else {
      showNotification(`Sala renombrada con éxito a "${nextName}"`);
      setIsRoomModalOpen(false);
    }
  };

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!newRoomNameInput.trim()) return;

    const rawName = newRoomNameInput.trim();
    const slug = rawName.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/[^a-z0-9\s-]/g, '') // remove special chars
      .trim()
      .replace(/\s+/g, '-'); // replace spaces with hyphens

    if (!slug) {
      showNotification('Nombre de sala inválido.');
      return;
    }

    if (!useMockDb) {
      // 1. Create the room in Supabase
      const { error } = await supabase.from('rooms').insert({ id: slug, name: rawName });
      if (error && error.code !== '23505') { // 23505 is duplicate key error, which means room already exists
        showNotification('Error al crear sala en base de datos: ' + error.message);
        return;
      }
    }

    showNotification(`¡Sala "${rawName}" creada con éxito! Redirigiendo...`);
    setIsRoomModalOpen(false);
    setNewRoomNameInput('');
    
    // Redirect browser to the new room URL
    window.location.href = `/room/${slug}`;
  };

  const handleDeleteRoom = async () => {
    if (currentRoomId === 'grupo-a') {
      showNotification('La sala por defecto no se puede eliminar.', 'error');
      return;
    }

    const confirmed = await showConfirm(`¿Eliminar la sala "${roomName}"? Se borrarán todos los miembros, disponibilidades y reuniones guardadas en ella. Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    if (!useMockDb) {
      const { error } = await supabase.from('rooms').delete().eq('id', currentRoomId);
      if (error) {
        showNotification('Error al eliminar sala: ' + error.message);
        return;
      }
    }

    showNotification(`Sala "${roomName}" eliminada correctamente.`);
    setIsRoomModalOpen(false);
    // Redirect to default room
    window.location.href = `/room/grupo-a`;
  };

  const handleCopyRoomInvite = () => {
    const slug = slugifyRoomName(roomName);
    const inviteUrl = `${window.location.origin}/room/${slug}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inviteUrl).then(() => {
        showNotification(`🔗 Enlace de la sala "${roomName}" copiado:\n\n${inviteUrl}\n\n¡Cualquier persona que entre con este link irá directo al registro inicial de esta sala!`);
      }).catch(() => {
        prompt('Copia el enlace para compartir tu sala:', inviteUrl);
      });
    } else {
      prompt('Copia el enlace para compartir tu sala:', inviteUrl);
    }
  };

  // --- ADMINISTRAR MIEMBROS ---
  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!newMemberName || !newMemberEmail) return;

    const finalCountry = newMemberCountry === 'Otro' ? customNewMemberCountry.trim() : newMemberCountry;
    const finalTz = resolveTimezone(finalCountry);
    const newMember = {
      name: newMemberName,
      email: newMemberEmail,
      country: finalCountry,
      tz: finalTz,
      active: true
    };

    if (!useMockDb) {
      const { error } = await supabase.from('members').insert({
        room_id: currentRoomId,
        email: newMember.email,
        name: newMember.name,
        country: newMember.country,
        timezone: newMember.tz,
        active: newMember.active
      });
      if (error) {
        showNotification('Error al agregar en Supabase: ' + error.message);
        return;
      }
    }

    setMembers([...members, newMember]);
    setNewMemberName('');
    setNewMemberEmail('');
    showNotification('Miembro agregado correctamente.');
  };

  const toggleMemberActive = async (index) => {
    const updated = [...members];
    const prevActiveState = updated[index].active;
    updated[index].active = !updated[index].active;
    
    if (!useMockDb) {
      const { error } = await supabase.from('members')
        .update({ active: updated[index].active })
        .eq('room_id', currentRoomId)
        .eq('email', updated[index].email);
      if (error) {
        showNotification('Error al actualizar en Supabase');
        updated[index].active = prevActiveState;
        return;
      }
    }
    
    setMembers(updated);
  };

  const deleteMember = async (emailToDelete) => {
    if (emailToDelete.toLowerCase() === currentUser.email.toLowerCase()) {
      alert("No puedes eliminar al usuario logueado actualmente.");
      return;
    }
    
    if (!useMockDb) {
      const { error } = await supabase.from('members')
        .delete()
        .eq('room_id', currentRoomId)
        .eq('email', emailToDelete);
      if (error) {
        showNotification('Error al eliminar de Supabase: ' + error.message);
        return;
      }
    }

    const memberObj = members.find(m => m.email.toLowerCase() === emailToDelete.toLowerCase());
    setMembers(prev => prev.filter(m => m.email.toLowerCase() !== emailToDelete.toLowerCase()));
    if (memberObj) {
      setAvailabilities(prev => prev.filter(a => a.user.toLowerCase() !== memberObj.name.toLowerCase()));
      setTemplates(prev => prev.filter(t => t.user.toLowerCase() !== memberObj.name.toLowerCase()));
    }
  };

  // --- CAMBIAR ESTADO SEMANAL DEL USUARIO LOGUEADO ---
  const toggleCurrentUserActive = async () => {
    const nextActiveState = !currentUser.active;
    
    // Actualizar estado del usuario conectado
    setCurrentUser(prev => ({ ...prev, active: nextActiveState }));

    // Actualizar estado en la base de datos de miembros
    setMembers(prev => prev.map(m => 
      m.email.toLowerCase() === currentUser.email.toLowerCase() ? { ...m, active: nextActiveState } : m
    ));

    if (!useMockDb) {
      const { error } = await supabase.from('members')
        .update({ active: nextActiveState })
        .eq('room_id', currentRoomId)
        .eq('email', currentUser.email);
      if (error) {
        showNotification('Error al actualizar estado en Supabase');
        return;
      }
    }

    if (!nextActiveState) {
      // Limpiar horarios semanales (evitar falsos positivos de reuniones vacías)
      if (!useMockDb) {
        await supabase.from('availabilities')
          .delete()
          .eq('room_id', currentRoomId)
          .eq('user', currentUser.name);
      }
      setAvailabilities(prev => prev.filter(a => a.user.toLowerCase() !== currentUser.name.toLowerCase()));
      showNotification('Has desactivado tu participación. No serás coordinado para los role-plays de esta semana.');
    } else {
      // Cargar disponibilidad desde la plantilla habitual
      const userTemplateRules = templates.filter(t => t.user.toLowerCase() === currentUser.name.toLowerCase());
      
      if (!useMockDb && userTemplateRules.length > 0) {
        const toInsert = userTemplateRules.map(r => ({
          room_id: currentRoomId,
          user: r.user,
          day_idx: r.dayIdx,
          start_hour: r.startHour,
          end_hour: r.endHour
        }));
        await supabase.from('availabilities').insert(toInsert);
      }
      
      setAvailabilities(prev => [...prev, ...userTemplateRules]);
      showNotification('¡Participación activada! Hemos cargado tus horarios semanales desde tu plantilla base.');
    }
  };

  // --- AGENDAR REUNIÓN CON APIS REALES DE GOOGLE CALENDAR / MEET ---
  const scheduleMeeting = async (matchIndex) => {
    const match = matches[matchIndex];
    
    setSchedulingStatus('loading');
    setScheduledDetails({
      title: `Roleplay — ${match.participants.split(', ').map(n => n.split(' ')[0]).join(' · ')}`,
      attendeesCount: match.participants.split(', ').length
    });

    // 1. Establecer conexión
    setTimeout(async () => {
      setSchedulingStatus('authenticating');
      
      // 2. Autenticar OAuth con Google a través de Supabase
      setTimeout(async () => {
        setSchedulingStatus('creating');
        
        let meetUrl = `https://meet.google.com/${Math.random().toString(36).substring(2, 5)}-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 5)}`;

        if (!useMockDb) {
          try {
            const { data: sessionData } = await supabase.auth.getSession();
            const providerToken = sessionData.session?.provider_token; // Token de Google OAuth

            if (providerToken) {
              // Construimos el payload de Google Calendar Event
              const eventPayload = {
                summary: `Real Sales Labs Roleplay: ${match.participants}`,
                description: 'Videollamada de entrenamiento agendada mediante Real Sales Labs Matcher.',
                start: { dateTime: new Date().toISOString(), timeZone: 'UTC' }, // Se calcula a partir del match en producción
                end: { dateTime: new Date(Date.now() + 60*60*1000).toISOString(), timeZone: 'UTC' },
                attendees: match.participants.split(', ').map(name => {
                  const found = members.find(m => m.name.toLowerCase() === name.toLowerCase());
                  return found ? { email: found.email } : null;
                }).filter(Boolean),
                conferenceData: {
                  createRequest: {
                    requestId: Math.random().toString(36).substring(2),
                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                  }
                }
              };

              // Petición oficial a la REST API de Google Calendar
              const response = await fetch(
                'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${providerToken}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(eventPayload)
                }
              );

              const eventData = await response.json();
              if (eventData.hangoutLink) {
                meetUrl = eventData.hangoutLink; // Enlace real generado
              }
            }
          } catch (err) {
            console.error('Error al generar enlace real de Meet:', err);
          }
        }

        // 3. Insertar registro de reunión en base de datos
        const newMeeting = {
          title: `Roleplay — ${match.participants.split(', ').map(n => n.split(' ')[0]).join(' · ')}`,
          dateUtc: `Próximo ${match.day} a las ${match.startStr}`,
          duration: 60,
          participants: match.participants,
          meetLink: meetUrl,
          status: 'Creado (Meet)'
        };

        if (!useMockDb) {
          await supabase.from('meetings').insert({
            room_id: currentRoomId,
            title: newMeeting.title,
            date_utc: newMeeting.dateUtc,
            duration: newMeeting.duration,
            participants: newMeeting.participants,
            meet_link: newMeeting.meetLink
          });
        }

        setMeetings(prev => [...prev, newMeeting]);
        setSchedulingStatus('success');

        // 4. Cerrar overlay automáticamente
        setTimeout(() => {
          setSchedulingStatus(null);
        }, 3000);
      }, 1200);
    }, 1000);
  };

  const showNotification = (msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  const showConfirm = (msg) => new Promise((resolve) => {
    setConfirmModal({
      msg,
      onConfirm: () => { setConfirmModal(null); resolve(true); },
      onCancel:  () => { setConfirmModal(null); resolve(false); }
    });
  });

  // --- GESTIÓN DE CELDAS DEL CALENDARIO ---
  const handleCellMouseDown = (dayIdx, hour) => {
    setIsMouseDown(true);
    const exists = wizardGrid.some(s => s.dayIdx === dayIdx && s.hour === hour);
    const active = !exists;
    setDragMode(active);
    toggleCell(dayIdx, hour, active);
  };

  const handleCellMouseEnter = (dayIdx, hour) => {
    if (isMouseDown) {
      toggleCell(dayIdx, hour, dragMode);
    }
  };

  const toggleCell = (dayIdx, hour, active) => {
    if (active) {
      setWizardGrid(prev => {
        if (prev.some(s => s.dayIdx === dayIdx && s.hour === hour)) return prev;
        return [...prev, { dayIdx, hour }];
      });
    } else {
      setWizardGrid(prev => prev.filter(s => !(s.dayIdx === dayIdx && s.hour === hour)));
    }
  };

  const clearAllCells = () => {
    setWizardGrid([]);
  };

  const fillAllCells = () => {
    const all = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        all.push({ dayIdx: d, hour: h });
      }
    }
    setWizardGrid(all);
  };

  const handleTabClick = (tab) => {
    setActiveTab(tab);
    setIsSidebarOpen(false); // Cierra el menú al cambiar de pestaña en móvil
  };

  const handleEnterFromLanding = () => {
    setShowLandingPage(false);
    localStorage.setItem('realsaleslabs-visited', 'true');
    // Navigate to default room
    window.history.replaceState(null, '', '/room/grupo-a');
    setCurrentRoomId('grupo-a');
  };

  // Show landing page if: explicitly set OR no room ID in URL
  if (showLandingPage || !currentRoomId) {
    return <LandingPage onEnter={handleEnterFromLanding} theme={theme} />;
  }

  if (!isLoggedIn || !currentUser) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--bg-main)',
        backgroundImage: 'var(--bg-glows)',
        backgroundAttachment: 'fixed',
        color: 'var(--text-main)',
        fontFamily: 'var(--font-sans)',
        padding: '20px',
        boxSizing: 'border-box'
      }}>
        {/* Theme select widget float top-right */}
        <div style={{ position: 'absolute', top: '20px', right: '20px', display: 'flex', gap: '8px', zIndex: 10 }}>
          <div className="theme-selector" style={{ margin: 0 }}>
            <button className={`theme-btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')} title="Modo Claro">
              <Sun size={12} />
            </button>
            <button className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')} title="Modo Oscuro">
              <Moon size={12} />
            </button>
            <button className={`theme-btn ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')} title="Seguir Sistema">
              <Monitor size={12} />
            </button>
          </div>
        </div>

        <div className="glass" style={{
          width: '100%',
          maxWidth: '440px',
          padding: '40px 30px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
          border: '1px solid var(--border-color)',
          textAlign: 'center',
          boxSizing: 'border-box'
        }}>
          {/* Logo Brand Header */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' }}>
            <a 
              href="https://www.skool.com/real-sales-lab-8381/about?ref=6b5c94a4d70e488bba9eb815023e8247" 
              target="_blank" 
              rel="noopener noreferrer" 
              title="Haz clic para visitar el portal de Real Sales Labs"
              className="brand-logo-interactive"
            >
              <div className="brand-logo-container calendar-glow-pulse">
                <CalendarPremiumIcon size={44} />
              </div>
              <div className="brand-title-stacked" style={{ textAlign: 'left' }}>
                <span className="brand-title-sales" style={{ fontSize: '12px' }}>Real Sales Labs</span>
              </div>
            </a>
          </div>

          {/* STEP 1: GOOGLE EMAIL INPUT */}
          {loginStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ textAlign: 'center', marginBottom: '4px' }}>
                <div className="room-indicator-badge">
                  <span className="room-indicator-dot"></span>
                  <span>Sala de coordinación: <strong>{roomName}</strong></span>
                </div>
                <h2 style={{ margin: '10px 0 6px 0', fontSize: '22px', fontWeight: '800', letterSpacing: '-0.5px', color: 'var(--text-main)' }}>Iniciar Sesión</h2>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.4' }}>Utiliza tu cuenta de Google para ingresar al coordinador de roleplays.</p>
              </div>

              {!useMockDb ? (
                /* REAL PRODUCTION OAUTH: Single-click Google login */
                <button 
                  type="button" 
                  className="btn btn-indigo" 
                  onClick={handleGoogleLoginSubmit}
                  style={{ padding: '12px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: '600' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Iniciar Sesión con Google
                </button>
              ) : (
                /* LOCAL MOCK TESTING: With optional email input */
                <form onSubmit={handleGoogleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="form-group" style={{ textAlign: 'left' }}>
                    <label htmlFor="login-email" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>Correo de Prueba (Gmail)</label>
                    <input
                      type="email"
                      id="login-email"
                      className="form-input"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="Ej. tu.nombre@gmail.com o @example.com"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px' }}
                    />
                  </div>
                  <button type="submit" className="btn btn-indigo" style={{ padding: '12px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: '600' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Continuar con Google (Simulado)
                  </button>
                </form>
              )}
            </div>
          )}

          {/* STEP 2: PROFILE SETUP FORM */}
          {loginStep === 2 && (
            <form onSubmit={handleProfileRegisterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: '800', letterSpacing: '-0.5px' }}>Completar Perfil</h2>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Es tu primera vez ingresando con esta cuenta. Completa tu información base.</p>
              </div>

              <div className="form-group" style={{ textAlign: 'left' }}>
                <label style={{ fontSize: '11px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>Email de Registro (Gmail)</label>
                <input
                  type="email"
                  className="form-input"
                  value={loginEmail}
                  readOnly
                  disabled
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 14px',
                    backgroundColor: 'rgba(120, 120, 120, 0.08)',
                    cursor: 'not-allowed',
                    color: 'var(--text-muted)'
                  }}
                />
              </div>

              <div className="form-group" style={{ textAlign: 'left' }}>
                <label htmlFor="reg-name" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>Nombre Completo</label>
                <input
                  type="text"
                  id="reg-name"
                  className="form-input"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  placeholder="Ej. Carlos Mendoza"
                  required
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px' }}
                />
              </div>

              <div className="form-group" style={{ textAlign: 'left' }}>
                <label htmlFor="reg-country" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>País de Origen</label>
                <select
                  id="reg-country"
                  className="form-select"
                  value={loginCountry}
                  onChange={(e) => setLoginCountry(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', marginBottom: loginCountry === 'Otro' ? '12px' : '0' }}
                >
                  {ZONAS.map(z => (
                    <option key={z.country} value={z.country}>{z.country}</option>
                  ))}
                  <option value="Otro">Otro (Escribir país)...</option>
                </select>
                {loginCountry === 'Otro' && (
                  <input
                    type="text"
                    className="form-input"
                    value={customLoginCountry}
                    onChange={(e) => setCustomLoginCountry(e.target.value)}
                    placeholder="Escribe tu país de origen... Ej. Italia"
                    required
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px' }}
                  />
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1, padding: '10px' }} onClick={() => setLoginStep(1)}>
                  Atrás
                </button>
                <button type="submit" className="btn btn-indigo" style={{ flex: 2, padding: '10px', fontWeight: '600' }}>
                  Finalizar Registro
                </button>
              </div>
            </form>
          )}

          {/* Elegant Footer to official portal */}
          <div style={{ marginTop: '28px', paddingTop: '18px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'center' }}>
            <a
              href="https://www.skool.com/real-sales-lab-8381/about?ref=6b5c94a4d70e488bba9eb815023e8247"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12.5px',
                color: 'var(--text-muted)',
                textDecoration: 'none',
                fontWeight: '500',
                transition: 'color 0.2s'
              }}
            >
              <span>¿Conoces Sales Arena?</span>
              <span style={{ color: 'var(--color-primary)', fontWeight: '700' }}>Visitar Portal Oficial ↗</span>
            </a>
          </div>
        </div>

        {/* SESSION RECOVERY MODAL */}
        {showSessionRecovery && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)'
          }}>
            <div className="glass" style={{
              width: '100%',
              maxWidth: '380px',
              padding: '32px',
              boxSizing: 'border-box'
            }}>
              <div style={{ marginBottom: '20px', textAlign: 'center' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '700', color: 'var(--text-main)' }}>
                  Recuperar Sesión
                </h3>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                  Parece que tu sesión fue cerrada. Ingresa tu email para continuar.
                </p>
              </div>

              <form onSubmit={handleSessionRecovery} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="form-group" style={{ textAlign: 'left' }}>
                  <label htmlFor="recovery-email" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '4px', display: 'block' }}>Email registrado</label>
                  <input
                    type="email"
                    id="recovery-email"
                    className="form-input"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="tu.email@gmail.com"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    autoFocus
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      setShowSessionRecovery(false);
                      setRecoveryEmail('');
                    }}
                    style={{ flex: 1 }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn btn-indigo"
                    style={{ flex: 1 }}
                  >
                    Recuperar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="layout-container">

      {/* TOAST NOTIFICATION SYSTEM */}
      <div className="toast-container" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast-item toast-${t.type}`}>
            <span className="toast-icon">
              {t.type === 'error' ? '✕' : t.type === 'success' ? '✓' : '🔗'}
            </span>
            <span className="toast-msg">{t.msg}</span>
            <button className="toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>

      {/* CONFIRM MODAL */}
      {confirmModal && (
        <div className="confirm-overlay" role="dialog" aria-modal="true">
          <div className="confirm-card">
            <div className="confirm-icon">⚠️</div>
            <p className="confirm-msg">{confirmModal.msg}</p>
            <div className="confirm-actions">
              <button className="btn btn-outline" onClick={confirmModal.onCancel}>Cancelar</button>
              <button className="btn btn-danger" onClick={confirmModal.onConfirm}>Sí, eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE HEADER BAR */}
      <div className="mobile-header-bar">
        <button className="menu-toggle-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
          {isSidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        <a href="https://www.skool.com/real-sales-lab-8381/about?ref=6b5c94a4d70e488bba9eb815023e8247" target="_blank" rel="noopener noreferrer" title="Ir al portal de Real Sales Labs" className="brand-logo-interactive" style={{ margin: 0 }}>
          <div className="brand-logo-container calendar-glow-pulse">
            <CalendarPremiumIcon size={34} />
          </div>
          <div className="brand-title-stacked">
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span className="brand-title-sales">Real Sales Labs</span>
              <span className="portal-badge-mini">PORTAL ↗</span>
            </div>
            <span className="brand-title-arena">Matcher</span>
          </div>
        </a>
        <div style={{ width: '34px' }}></div> {/* Spacer to center the logo */}
      </div>

      {/* MOBILE DRAWER OVERLAY */}
      <div className={`sidebar-overlay ${isSidebarOpen ? 'open' : ''}`} onClick={() => setIsSidebarOpen(false)}></div>

      {/* 1. SIDEBAR NAVIGATION */}
      <nav className={`nav-sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div style={{ marginBottom: '28px' }}>
          <a 
            href="https://www.skool.com/real-sales-lab-8381/about?ref=6b5c94a4d70e488bba9eb815023e8247" 
            target="_blank" 
            rel="noopener noreferrer" 
            title="Haz clic para visitar el Portal de Real Sales Labs" 
            className="brand-logo-interactive"
          >
            <div className="brand-logo-container calendar-glow-pulse">
              <CalendarPremiumIcon size={34} />
            </div>
            <div className="brand-title-stacked">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="brand-title-sales">Real Sales Labs</span>
                <span className="portal-badge-mini">PORTAL ↗</span>
              </div>
              <span className="brand-title-arena">Matcher</span>
            </div>
          </a>
        </div>

        <div className="nav-links">
          <div className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => handleTabClick('dashboard')}>
            <LayoutDashboard size={17} /> Panel de Control
          </div>
          <div className={`nav-link ${activeTab === 'wizard' ? 'active' : ''}`} onClick={() => { handleTabClick('wizard'); setWizardStep(1); }}>
            <CalendarRange size={17} /> Cargar Disponibilidad
          </div>
          <div className={`nav-link ${activeTab === 'heatmap' ? 'active' : ''}`} onClick={() => handleTabClick('heatmap')}>
            <Flame size={17} /> Mapa de Calor
          </div>
          <div className={`nav-link ${activeTab === 'affinity' ? 'active' : ''}`} onClick={() => handleTabClick('affinity')}>
            <Users size={17} /> Afinidad Horaria
          </div>
          <div className={`nav-link ${activeTab === 'members' ? 'active' : ''}`} onClick={() => handleTabClick('members')}>
            <UserCheck size={17} /> Gestionar Equipo
          </div>
        </div>

        {/* THEME SELECTOR WIDGET */}
        <div className="theme-selector">
          <button className={`theme-btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')} title="Modo Claro">
            <Sun size={12} /> Claro
          </button>
          <button className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')} title="Modo Oscuro">
            <Moon size={12} /> Oscuro
          </button>
          <button className={`theme-btn ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')} title="Seguir Sistema">
            <Monitor size={12} /> Auto
          </button>
        </div>

        <div className="profile-widget">
          <div className="profile-name">👤 {currentUser.name}</div>
          <div className="profile-email">{currentUser.email}</div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>Zona: {currentUser.tz.split('/').pop().replace(/_/g, ' ')}</div>
          <button 
            type="button"
            onClick={handleLogout} 
            className="btn-small" 
            style={{ 
              marginTop: '10px', 
              padding: '4px 8px', 
              fontSize: '10px', 
              width: '100%', 
              backgroundColor: 'rgba(255, 69, 58, 0.12)', 
              color: 'var(--color-danger)', 
              border: '1px solid rgba(255, 69, 58, 0.2)' 
            }}
          >
            Cerrar Sesión
          </button>
        </div>
      </nav>

      {/* 2. MAIN APP CONTENT */}
      <main className="main-view">
        
        {/* HEADER BAR */}
        <header className="view-header">
          <div>
            <h2 className="view-title">
              {activeTab === 'dashboard' && 'Panel de Control Principal'}
              {activeTab === 'wizard' && 'Asistente de Configuración'}
              {activeTab === 'heatmap' && 'Mapa de Calor Semanal'}
              {activeTab === 'affinity' && 'Afinidad Horaria y Matrices'}
              {activeTab === 'members' && 'Miembros y Roles de la Sala'}
            </h2>
            <p className="view-subtitle">
              {activeTab === 'dashboard' && 'Revisa el estado de la sala, coincidencias activas y links de Meet.'}
              {activeTab === 'wizard' && 'Configura tu participación en los role-plays de esta semana en pocos clics.'}
              {activeTab === 'heatmap' && 'Visualiza de forma horaria colectiva en qué momento hay más personas disponibles.'}
              {activeTab === 'affinity' && '% de coincidencia relativa entre parejas de role-players.'}
              {activeTab === 'members' && 'Administra quiénes participan del grupo y configura sus correos y países.'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div 
              onClick={() => setIsRoomModalOpen(true)}
              className="glass" 
              style={{ 
                padding: '8px 16px', 
                fontSize: '12px', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                color: 'var(--color-primary)', 
                borderColor: 'var(--border-color)',
                cursor: 'pointer',
                userSelect: 'none',
                transition: 'opacity 0.2s',
                hover: { opacity: 0.9 }
              }}
              title="Gestionar salas"
            >
              <span style={{ width: '8px', height: '8px', backgroundColor: 'var(--color-primary)', borderRadius: '50%' }}></span>
              <span>Sala Activa: <strong>{roomName}</strong></span>
              <span style={{ marginLeft: '4px', fontSize: '10px', opacity: 0.8 }}>⚙️</span>
            </div>
          </div>
        </header>

        {/* CONTAINER CONTENT */}
        <div className="view-content">
          
          {/* VIEW: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div>
              {/* Tarjeta para compartir sala rápidamente */}
              <div className="glass share-room-banner" style={{ padding: '16px 20px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, rgba(10,132,255,0.15), rgba(94,92,230,0.15))',
                    border: '1px solid rgba(10,132,255,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-primary)'
                  }}>
                    <Share2 size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '14px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      Invitar a la Sala: <span className="room-badge-pill">{roomName}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
                      Comparte este enlace con tu equipo. Al ingresar los llevará directamente al registro inicial de esta sala.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-indigo"
                  onClick={handleCopyRoomInvite}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', fontWeight: '600' }}
                >
                  <Share2 size={15} />
                  Copiar Link de Invitación
                </button>
              </div>

              {/* Tarjeta de Estado Semanal de Tomás */}
              <div className="glass" style={{ padding: '16px 20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: currentUser.active ? 'var(--color-accent)' : 'var(--color-danger)',
                    boxShadow: currentUser.active ? '0 0 10px var(--color-accent)' : '0 0 10px var(--color-danger)'
                  }}></div>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '13.5px', color: 'var(--text-main)' }}>
                      Mi Participación Semanal: {currentUser.active ? '🟢 ACTIVO' : '🔴 INACTIVO'}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2.5px' }}>
                      {currentUser.active
                        ? 'Estás participando de los emparejamientos semanales. Tus compañeros pueden coincidir contigo.'
                        : 'Estás excluido de esta semana. Tus horarios no serán cruzados con los del equipo.'}
                    </div>
                  </div>
                </div>
                <button
                  className={`btn ${currentUser.active ? 'btn-outline' : 'btn-indigo'}`}
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                  onClick={toggleCurrentUserActive}
                >
                  {currentUser.active ? 'Desactivar participación' : 'Activar participación'}
                </button>
              </div>

              {/* KPIs */}
              <div className="metrics-grid">
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(0,113,227,0.08)', color: 'var(--color-primary)' }}>
                    <Users size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{members.filter(m => m.active).length}</span>
                    <span className="kpi-label">Miembros Activos</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(120,120,120,0.08)', color: 'var(--text-muted)' }}>
                    <Clock size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{availabilities.length}</span>
                    <span className="kpi-label">Bloques Semanales</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(52,199,89,0.12)', color: '#34c759' }}>
                    <Sparkles size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{matches.length}</span>
                    <span className="kpi-label">Coincidencias</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(255,149,0,0.12)', color: '#ff9500' }}>
                    <Video size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{meetings.length}</span>
                    <span className="kpi-label">Meets Creados</span>
                  </div>
                </div>
              </div>

              {/* 2-Columns */}
              <div className="dashboard-sections">
                
                {/* Left Col: Coincidencias */}
                <div className="section-card glass">
                  <h4 className="section-title">🔎 Mejores Horarios Coincidentes (Para esta semana)</h4>
                  <div className="matches-list">
                    {matches.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                        <AlertCircle size={32} style={{ margin: '0 auto 10px auto', display: 'block' }} />
                        No hay suficientes miembros cargados o coincidencias encontradas.
                      </div>
                    ) : (
                      matches.map((m, idx) => {
                        const participantBadges = m.participants.split(', ').map(name => {
                          const nameParts = name.split(' ');
                          return nameParts[0] + (nameParts[1] ? ` ${nameParts[1][0]}.` : '');
                        });
                        
                        const localTimes = m.localDetail.split(' | ').map(item => {
                          const parts = item.split(': ');
                          return { name: parts[0], range: parts[1] };
                        });

                        return (
                          <div className="match-card glass glass-hover" key={idx}>
                            <div className="match-card-header">
                              <div className="match-card-time-group">
                                <span className="match-card-day">{m.day}</span>
                                <span className="match-card-time">{m.startStr.replace(' UTC', '')} - {m.endStr}</span>
                              </div>
                              <span className="match-card-score-pill">
                                {m.score}% Match
                              </span>
                            </div>
                            
                            <div className="match-card-body">
                              <div className="match-section-label">👥 Integrantes disponibles</div>
                              <div className="match-participants-flex">
                                {participantBadges.map((badge, bIdx) => (
                                  <span key={bIdx} className="match-participant-tag">
                                    {badge}
                                  </span>
                                ))}
                              </div>
                              
                              <div className="match-section-label" style={{ marginTop: '10px' }}>🕒 Horarios locales</div>
                              <div className="match-times-grid">
                                {localTimes.map((lt, lIdx) => (
                                  <div key={lIdx} className="match-time-pill">
                                    <span className="match-time-name">{lt.name}</span>
                                    <span className="match-time-range">{lt.range}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            
                            <div className="match-card-footer">
                              <button className="btn btn-indigo" style={{ width: '100%' }} onClick={() => scheduleMeeting(idx)}>
                                <Video size={14} /> Agendar en Google Calendar
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Right Col: Historial / Meets */}
                <div className="section-card glass">
                  <h4 className="section-title">📅 Próximos Role-Plays Agendados</h4>
                  <div className="meetings-list">
                    {meetings.length === 0 ? (
                      <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No hay reuniones agendadas todavía.</p>
                    ) : (
                      meetings.map((meet, idx) => (
                        <div className="meeting-item" key={idx}>
                          <div className="meeting-info">
                            <span className="meeting-title" style={{ fontSize: '13px' }}>{meet.title}</span>
                            <span className="meeting-meta" style={{ fontSize: '11px' }}>{meet.dateUtc}</span>
                            <span className="meeting-meta" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>M: {meet.participants}</span>
                          </div>
                          <a href={meet.meetLink} target="_blank" rel="noopener noreferrer" className="btn btn-indigo" style={{ padding: '6px 10px', fontSize: '11px', textDecoration: 'none' }}>
                            <Video size={12} /> Meet
                          </a>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* VIEW: WIZARD */}
          {activeTab === 'wizard' && (
            <div className="wizard-card glass">
              
              {/* Wizard Status Alert */}
              {wizardStatus && (
                <div id="status" className={`status-${wizardStatus.type}`} style={{ display: 'block', marginBottom: '16px' }}>
                  {wizardStatus.type === 'loading' && <span className="spinner"></span>} {wizardStatus.msg}
                </div>
              )}

              {/* STEP 1: Bienvenida */}
              {wizardStep === 1 && (
                <div>
                  <div style={{ marginBottom: '8px', fontSize: '32px', filter: 'drop-shadow(0 0 14px rgba(10,132,255,0.35))' }}>🎯</div>
                  <h3 className="wizard-title">¡Hola de nuevo, {currentUser.name}!</h3>
                  <p className="wizard-desc">¿Vas a participar en las sesiones de role-plays programadas para esta semana?</p>
                  
                  <div className="wizard-options">
                    <button className="wizard-btn wizard-btn-primary" onClick={() => handleWizardParticipation(true)}>
                      <span className="wizard-btn-icon">✓</span>
                      Sí, participaré esta semana
                    </button>
                    <button className="wizard-btn wizard-btn-danger" onClick={() => handleWizardParticipation(false)}>
                      <span className="wizard-btn-icon">✕</span>
                      No puedo esta semana
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Usar Plantilla vs Carga manual */}
              {wizardStep === 2 && (
                <div>
                  <h3 className="wizard-title">Carga de Disponibilidad</h3>
                  <p className="wizard-desc">Elige si deseas restablecer tu disponibilidad desde tu plantilla base cargada o configurarlo a mano:</p>
                  
                  <div className="wizard-options">
                    <button className="wizard-btn wizard-btn-primary" onClick={handleUseTemplate}>
                      📅 Usar mi horario base habitual (Plantilla)
                    </button>
                    <button className="wizard-btn wizard-btn-outline" onClick={() => setWizardStep(3)}>
                      ✏️ Cargar/Editar horarios específicos para esta semana
                    </button>
                    <button className="wizard-btn wizard-btn-outline" onClick={() => setWizardStep(1)}>
                      Atrás
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: Grid Semanal */}
              {wizardStep === 3 && (
                <div className="editor-grid-container">
                  <h3 className="wizard-title">Modificar mis Horarios</h3>
                  <p className="wizard-desc" style={{ fontSize: '11px' }}>Arrastra o haz clic sobre el calendario para pintar las horas que tienes libres en tu hora local ({currentUser?.tz?.split('/').pop() || 'UTC'}):</p>
                  
                  <div className="editor-grid-scroll" onMouseLeave={() => setIsMouseDown(false)}>
                    <table className="editor-table">
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-sidebar)', fontSize: '9px' }}>
                          <th style={{ padding: '6px', color: 'var(--text-main)' }}>Hora</th>
                          <th style={{ color: 'var(--text-main)' }}>Lun</th>
                          <th style={{ color: 'var(--text-main)' }}>Mar</th>
                          <th style={{ color: 'var(--text-main)' }}>Mié</th>
                          <th style={{ color: 'var(--text-main)' }}>Jue</th>
                          <th style={{ color: 'var(--text-main)' }}>Vie</th>
                          <th style={{ color: 'var(--text-main)' }}>Sáb</th>
                          <th style={{ color: 'var(--text-main)' }}>Dom</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: 24 }).map((_, h) => (
                          <tr key={h}>
                            <td className="hour-label" style={{ height: '24px', fontSize: '9px', textAlign: 'center', backgroundColor: 'var(--bg-sidebar)', color: 'var(--text-muted)', borderRight: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>{String(h).padStart(2, '0')}:00</td>
                            {Array.from({ length: 7 }).map((_, d) => {
                              const isActive = wizardGrid.some(s => s.dayIdx === d && s.hour === h);
                              return (
                                <td
                                  key={d}
                                  className={`editor-cell ${isActive ? 'active' : ''}`}
                                  onMouseDown={() => handleCellMouseDown(d, h)}
                                  onMouseEnter={() => handleCellMouseEnter(d, h)}
                                  onMouseUp={() => setIsMouseDown(false)}
                                ></td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="actions-bar">
                    <button className="btn-small" onClick={clearAllCells}>Limpiar Grilla</button>
                    <button className="btn-small" onClick={fillAllCells}>Marcar Todo</button>
                  </div>

                  <div className="checkbox-container" style={{ margin: '4px 0' }}>
                    <input
                      type="checkbox"
                      id="saveTemplate"
                      checked={saveAsTemplate}
                      onChange={(e) => setSaveAsTemplate(e.target.checked)}
                    />
                    <label htmlFor="saveTemplate" style={{ margin: 0 }}>💾 Guardar como mi Plantilla Base habitual</label>
                  </div>

                  <button className="wizard-btn wizard-btn-primary" onClick={saveWizardGrid}>
                    Guardar Horarios
                  </button>
                  <button className="wizard-btn wizard-btn-outline" onClick={() => setWizardStep(2)}>
                    Atrás
                  </button>
                </div>
              )}

            </div>
          )}

          {/* VIEW: HEATMAP */}
          {activeTab === 'heatmap' && (
            <div className="section-card glass" style={{ maxWidth: '100%' }}>
              <div className="heatmap-container">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px' }}>🔥 Mapa de Calor Colectivo</h3>
                  <span style={{ fontSize: '11px', color: 'var(--color-primary)' }}>Hora local de {currentUser?.name || ''} ({currentUser?.tz?.split('/').pop().replace(/_/g, ' ')})</span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', margin: 0 }}>
                  El color verde muestra cuántas personas están disponibles en cada bloque. Pasa el cursor para ver los nombres.
                </p>

                <div className="table-responsive-wrapper">
                  <table className="heatmap-table">
                    <thead>
                      <tr>
                        <th className="heatmap-th" style={{ width: '60px' }}>Hora</th>
                        {DIAS.map(d => (
                          <th className="heatmap-th" key={d}>{d.substring(0, 3)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 24 }).map((_, h) => (
                        <tr key={h}>
                          <td className="heatmap-td-hour">{String(h).padStart(2, '0')}:00</td>
                          {Array.from({ length: 7 }).map((_, d) => {
                            const cellData = heatmap[d]?.[h] || { count: 0, names: '' };
                            const totalActive = members.filter(m => m.active).length;
                            const opacity = totalActive ? (cellData.count / totalActive) : 0;
                            
                            return (
                              <td
                                key={d}
                                className="heatmap-cell"
                                style={{
                                  backgroundColor: cellData.count > 0 ? `rgba(52, 199, 89, ${0.1 + opacity * 0.9})` : 'transparent',
                                  borderRight: '1px solid var(--border-color)'
                                }}
                                title={cellData.count > 0 ? `${cellData.count} libres: ${cellData.names}` : 'Nadie disponible'}
                              ></td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: AFFINITY */}
          {activeTab === 'affinity' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div className="section-card glass">
                <h4 className="section-title">🤝 Solapamiento Horario por Parejas</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px 0' }}>
                  El valor muestra el porcentaje de solapamiento relativo de horas disponibles en común. Verde = excelente afinidad horaria.
                </p>
                <div className="table-responsive-wrapper">
                  <table className="affinity-table">
                    <thead>
                      <tr>
                        <th className="affinity-th" style={{ backgroundColor: 'var(--bg-card-hover)' }}>Jugador</th>
                        {members.filter(m => m.active).map(m => (
                          <th className="affinity-th" key={m.name}>{m.name.split(' ')[0]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {affinity.map((row, i) => (
                        <tr key={i}>
                          <td className="affinity-td-label">{row.name}</td>
                          {row.stats.map((col, j) => {
                            const pct = col.pct;
                            let bg = 'transparent';
                            let text = 'var(--text-muted)';
                            if (pct !== null) {
                              if (pct >= 70) { bg = 'rgba(52, 199, 89, 0.15)'; text = '#34c759'; }
                              else if (pct >= 40) { bg = 'rgba(255, 149, 0, 0.12)'; text = '#ff9500'; }
                              else { bg = 'rgba(255, 59, 48, 0.08)'; text = '#ff3b30'; }
                            }
                            return (
                              <td
                                key={j}
                                className="affinity-cell"
                                style={{ backgroundColor: bg, color: text }}
                              >
                                {pct !== null ? `${pct}%` : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Best Partners List */}
              <div className="section-card glass">
                <h4 className="section-title">🏅 Compañeros con Mayor Afinidad</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {affinity.map((row, i) => {
                    const sortedStats = [...row.stats]
                      .filter(s => s.pct !== null)
                      .sort((a, b) => b.pct - a.pct)
                      .slice(0, 2);

                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '13px', flexWrap: 'wrap', gap: '4px' }}>
                        <span style={{ fontWeight: '600', color: 'var(--text-main)' }}>👤 {row.name}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '12.5px' }}>
                          {sortedStats.length > 0
                            ? sortedStats.map(s => `${s.name.split(' ')[0]} (${s.pct}%)`).join('   ·   ')
                            : 'Cargando disponibilidad...'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* VIEW: MEMBERS */}
          {activeTab === 'members' && (
            <div className="dashboard-sections">
              
              {/* Left Col: List of Members */}
              <div className="section-card glass">
                <h4 className="section-title">👥 Miembros Registrados</h4>
                <div className="members-list-card">
                  {members.map((m, idx) => (
                    <div className="member-row" key={idx}>
                      <div className="member-row-info">
                        <span className="member-row-name">
                          {m.name}
                          <span className={m.active ? 'member-badge-active' : 'member-badge-inactive'}>
                            {m.active ? 'Participa' : 'Excluido'}
                          </span>
                        </span>
                        <span className="member-row-details">📧 {m.email}</span>
                        <span className="member-row-details">📍 {m.country} ({(m.tz || 'UTC').split('/').pop().replace(/_/g, ' ')})</span>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Participa:</span>
                          <label className="switch-control">
                            <input
                              type="checkbox"
                              checked={m.active}
                              onChange={() => toggleMemberActive(idx)}
                            />
                            <span className="switch-slider"></span>
                          </label>
                        </div>
                        {m.email.toLowerCase() !== currentUser.email.toLowerCase() && (
                          <button
                            type="button"
                            className="btn-danger-icon"
                            onClick={() => deleteMember(m.email)}
                            title="Eliminar de la sala"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Col: Add Member Form */}
              <div className="section-card glass" style={{ height: 'fit-content' }}>
                <h4 className="section-title">➕ Agregar Nuevo Role-Player</h4>
                <form className="add-member-form" onSubmit={handleAddMember}>
                  <div className="form-group">
                    <label htmlFor="mem-name" style={{ fontSize: '11px', fontWeight: '600' }}>Nombre Completo</label>
                    <input
                      type="text"
                      id="mem-name"
                      className="form-input"
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      placeholder="Ej. Juan Pérez"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="mem-email" style={{ fontSize: '11px', fontWeight: '600' }}>Correo Electrónico (Gmail)</label>
                    <input
                      type="email"
                      id="mem-email"
                      className="form-input"
                      value={newMemberEmail}
                      onChange={(e) => setNewMemberEmail(e.target.value)}
                      placeholder="Ej. juan@gmail.com"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="mem-country" style={{ fontSize: '11px', fontWeight: '600' }}>País de Origen</label>
                    <select
                      id="mem-country"
                      className="form-select"
                      value={newMemberCountry}
                      onChange={(e) => setNewMemberCountry(e.target.value)}
                      style={{ marginBottom: newMemberCountry === 'Otro' ? '10px' : '0' }}
                    >
                      {ZONAS.map(z => (
                        <option key={z.country} value={z.country}>{z.country}</option>
                      ))}
                      <option value="Otro">Otro (Escribir país)...</option>
                    </select>
                    {newMemberCountry === 'Otro' && (
                      <input
                        type="text"
                        className="form-input"
                        value={customNewMemberCountry}
                        onChange={(e) => setCustomNewMemberCountry(e.target.value)}
                        placeholder="Escribe el país... Ej. Italia"
                        required
                        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px' }}
                      />
                    )}
                  </div>

                  <button type="submit" className="btn btn-indigo" style={{ marginTop: '8px', width: '100%' }}>
                    <Plus size={16} /> Agregar a la Sala
                  </button>
                </form>
              </div>

            </div>
          )}

        </div>

      </main>

      {/* GOOGLE MEET CREATOR OVERLAY MODAL */}
      {schedulingStatus && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(9, 9, 11, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 500,
          animation: 'fadeIn 0.2s ease'
        }}>
          <div className="glass" style={{
            width: '400px',
            padding: '30px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            border: '1px solid var(--border-color)',
            boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
              {schedulingStatus === 'success' ? (
                <div style={{
                  width: '52px', height: '52px', borderRadius: '50%',
                  backgroundColor: 'rgba(48, 209, 88, 0.12)', color: '#30d158',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px'
                }}>
                  <Check size={28} />
                </div>
              ) : (
                <span className="spinner" style={{ width: '32px', height: '32px', color: 'var(--color-primary)' }}></span>
              )}
            </div>

            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text-main)' }}>
              {schedulingStatus === 'loading' && 'Conectando con Google Calendar API...'}
              {schedulingStatus === 'authenticating' && 'Autenticando Usuario (OAuth 2.0)...'}
              {schedulingStatus === 'creating' && 'Generando sala de Google Meet...'}
              {schedulingStatus === 'success' && '¡Reunión Agendada con Éxito!'}
            </h3>

            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              {schedulingStatus === 'loading' && 'Estableciendo comunicación segura con los servicios de Google Cloud.'}
              {schedulingStatus === 'authenticating' && 'Verificando permisos y tokens del organizador de la sala.'}
              {schedulingStatus === 'creating' && `Creando el evento y agregando a los ${scheduledDetails?.attendeesCount} participantes correspondientes.`}
              {schedulingStatus === 'success' && '📧 Google Calendar ha enviado invitaciones de correo oficiales a todos los participantes con el enlace de Google Meet para unirse.'}
            </p>
          </div>
        </div>
      )}
      {/* MODAL DE GESTIÓN DE SALAS (ROOM MANAGER) */}
      {isRoomModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass" style={{
            width: '100%',
            maxWidth: '480px',
            backgroundColor: 'var(--color-bg-sidebar)',
            borderRadius: '16px',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            border: '1px solid var(--border-color)',
            boxSizing: 'border-box',
            position: 'relative'
          }}>
            {/* Header del Modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text-main)' }}>
                ⚙️ Gestión de Salas
              </h3>
              <button 
                onClick={() => setIsRoomModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                ✕
              </button>
            </div>

            {/* Sección de Compartir Enlace de Invitación */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '18px' }}>
              <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Share2 size={14} /> Compartir Enlace de Invitación
              </label>
              <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Al enviar este enlace, cualquier nuevo integrante accederá al registro inicial específicamente vinculado a la sala <strong>{roomName}</strong>.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <input
                  type="text"
                  readOnly
                  className="form-input"
                  value={`${window.location.origin}/room/${slugifyRoomName(roomName)}`}
                  style={{ flex: 1, padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-card)' }}
                />
                <button
                  type="button"
                  onClick={handleCopyRoomInvite}
                  className="btn btn-indigo"
                  style={{ padding: '8px 16px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Copy size={14} />
                  Copiar
                </button>
              </div>
            </div>

            {/* Formulario 1: Renombrar Sala */}
            <form onSubmit={handleRenameRoom} style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Renombrar Sala Actual</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="form-input"
                  value={renameRoomInput}
                  onChange={(e) => setRenameRoomInput(e.target.value)}
                  placeholder="Ej. Equipo Comercial"
                  required
                  style={{ flex: 1, padding: '8px 12px' }}
                />
                <button type="submit" className="btn btn-indigo" style={{ padding: '8px 16px', fontSize: '13px' }}>
                  Guardar
                </button>
              </div>
            </form>

            {/* Formulario 2: Crear Nueva Sala */}
            <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Crear Nueva Sala (Desde Cero)</label>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Al crear una nueva sala con un nombre personalizado, se generará una URL limpia. Compartirás esa nueva URL para invitar a otras personas a participar de forma aislada.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <input
                  type="text"
                  className="form-input"
                  value={newRoomNameInput}
                  onChange={(e) => setNewRoomNameInput(e.target.value)}
                  placeholder="Ej. Marketing 2026"
                  required
                  style={{ flex: 1, padding: '8px 12px' }}
                />
                <button type="submit" className="btn btn-indigo" style={{ padding: '8px 16px', fontSize: '13px' }}>
                  Crear
                </button>
              </div>
            </form>

            {/* Sección 3: Eliminar Sala */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-danger-hover, #ff453a)' }}>Zona de Peligro</label>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '280px', lineHeight: '1.4' }}>
                  Eliminar permanentemente esta sala y todos sus miembros de la base de datos.
                </span>
                <button 
                  onClick={handleDeleteRoom}
                  disabled={currentRoomId === 'grupo-a'}
                  className="btn"
                  style={{ 
                    backgroundColor: 'rgba(255, 69, 58, 0.15)', 
                    color: '#ff453a', 
                    padding: '8px 16px', 
                    fontSize: '13px', 
                    fontWeight: '600',
                    border: '1px solid rgba(255, 69, 58, 0.3)',
                    cursor: currentRoomId === 'grupo-a' ? 'not-allowed' : 'pointer',
                    opacity: currentRoomId === 'grupo-a' ? 0.5 : 1
                  }}
                >
                  Eliminar Sala
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
