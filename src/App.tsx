import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from './firebase';
import { collection, doc, setDoc, onSnapshot, query, where, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Trophy, Camera, CheckCircle, LogOut, Users, PlusCircle, ShieldCheck, Edit, MapPin, Search, Calendar, Phone, Activity, LayoutGrid, List, X, Printer, PartyPopper } from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth';

const getBirthdayStatus = (dateStr: string | undefined) => {
  if (!dateStr || dateStr.length !== 10) return null;
  const [d, m] = dateStr.split('/');
  const bMonth = parseInt(m, 10) - 1;
  const bDay = parseInt(d, 10);
  if (isNaN(bMonth) || isNaN(bDay)) return null;

  const today = new Date();
  const tMonth = today.getMonth();
  const tDay = today.getDate();

  if (bMonth === tMonth && bDay === tDay) return 'today';
  
  const todayDate = new Date(today.getFullYear(), tMonth, tDay);
  let nextBday = new Date(today.getFullYear(), bMonth, bDay);
  if (nextBday.getTime() < todayDate.getTime()) {
    nextBday.setFullYear(today.getFullYear() + 1);
  }
  const diffDays = Math.ceil((nextBday.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24)); 
  if (diffDays > 0 && diffDays <= 7) return 'upcoming';
  
  return null;
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Very simple uuid generator
function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 400;
        const MAX_HEIGHT = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        // Returns base64 string (increased quality for the cards)
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<'cadastro' | 'galeria' | 'squad'>('galeria');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedSquadPlayers, setSelectedSquadPlayers] = useState<any[]>([]);
  
  const [form, setForm] = useState({
    teamName: '',
    coach: '',
    player: '',
    nickname: '',
    phone: '',
    isWhatsapp: false,
    birthDate: '',
    cep: '',
    address: '',
    addressNumber: '',
    neighborhood: '',
    city: '',
    state: '',
    position: '',
    height: '',
    weight: '',
    photo: null as File | null,
    existingPhotoUrl: ''
  });

  // Filtros
  const [filterCity, setFilterCity] = useState('');
  const [filterTeam, setFilterTeam] = useState('');
  const [filterPosition, setFilterPosition] = useState('');
  // Visualização (Tabela ou Cards)
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  const [selectedPlayer, setSelectedPlayer] = useState<any | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const pathForOnSnapshot = 'teams';
    const qVerified = query(collection(db, pathForOnSnapshot), where('isVerified', '==', true));

    const unsubscribeVerified = onSnapshot(qVerified, (snapshot) => {
      const verifiedTeams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTeams(prev => {
        const others = prev.filter(p => !p.isVerified); // keep unverified items
        const merged = [...verifiedTeams, ...others].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
        return merged;
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, pathForOnSnapshot));

    return () => {
      unsubscribeVerified();
    }
  }, []);

  useEffect(() => {
    if (!user || (!user.emailVerified && !user.isAnonymous)) {
      setTeams(prev => prev.filter(t => t.isVerified)); // clear unverified if logged out
      return;
    }

    const isAdmin = user.email === 'allan.muniz88@gmail.com';
    const pathForOnSnapshot = 'teams';
    // Se for admin, busca tudo para avaliar. Se for user normal, busca só os pendentes próprios.
    const qOwnedOrAdmin = isAdmin 
      ? query(collection(db, pathForOnSnapshot)) 
      : query(collection(db, pathForOnSnapshot), where('ownerId', '==', user.uid));

    const unsubscribeOwnedOrAdmin = onSnapshot(qOwnedOrAdmin, (snapshot) => {
      const docsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTeams(prev => {
        const others = prev.filter(p => p.ownerId !== user.uid && !isAdmin);
        const merged = [...others, ...docsData].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
        return merged;
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, pathForOnSnapshot));

    return () => {
      unsubscribeOwnedOrAdmin();
    }
  }, [user]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/unauthorized-domain') {
        alert('Erro: O domínio atual não está autorizado no Firebase. Adicione este domínio (' + window.location.hostname + ') na seção "Authorized domains" do Firebase Authentication.');
      } else {
        alert('Erro ao fazer login: ' + error.message);
      }
    }
  };

  const handleApprove = async (teamId: string) => {
    try {
      await updateDoc(doc(db, 'teams', teamId), {
        isVerified: true,
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      console.error(err);
      alert('Erro ao aprovar: ' + err.message);
    }
  };

  const handleEdit = (team: any) => {
    setForm({
      teamName: team.teamName || '',
      coach: team.coach || '',
      player: team.playerName || '',
      nickname: team.nickname || '',
      phone: team.phone || '',
      isWhatsapp: team.isWhatsapp || false,
      birthDate: team.birthDate || '',
      cep: team.cep || '',
      address: team.address || '',
      addressNumber: team.addressNumber || '',
      neighborhood: team.neighborhood || '',
      city: team.city || '',
      state: team.state || '',
      position: team.position || '',
      height: team.height || '',
      weight: team.weight || '',
      photo: null,
      existingPhotoUrl: team.playerPhoto || ''
    });
    setEditingId(team.id);
    setCurrentView('cadastro');
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 11) val = val.slice(0, 11);
    
    if (val.length > 2) {
      val = `(${val.slice(0, 2)}) ${val.slice(2)}`;
    }
    if (val.length > 9) {
      val = `${val.slice(0, 10)}-${val.slice(10)}`;
    }
    setForm(prev => ({ ...prev, phone: val }));
  };

  const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 0) {
        if (val.length === 1) val = `0,0${val}`;
        else if (val.length === 2) val = `0,${val}`;
        else {
            val = val.slice(0, 3);
            val = `${val.slice(0, 1)},${val.slice(1)}`;
        }
    }
    setForm(prev => ({ ...prev, height: val }));
  };

  const handleWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 3) val = val.slice(0, 3); // Max 999kg
    setForm(prev => ({ ...prev, weight: val }));
  };

  const handleBirthDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 8) val = val.slice(0, 8);
    if (val.length >= 5) {
      val = `${val.slice(0, 2)}/${val.slice(2, 4)}/${val.slice(4)}`;
    } else if (val.length >= 3) {
      val = `${val.slice(0, 2)}/${val.slice(2)}`;
    }
    setForm(prev => ({ ...prev, birthDate: val }));
  };

  const handleCepChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 8) val = val.slice(0, 8);
    if (val.length > 5) {
        val = `${val.slice(0, 5)}-${val.slice(5)}`;
    }
    setForm(prev => ({ ...prev, cep: val }));

    const rawCep = val.replace(/\D/g, '');
    if (rawCep.length === 8) {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${rawCep}/json/`);
        const data = await res.json();
        if (!data.erro) {
           setForm(prev => ({ 
             ...prev, 
             address: data.logradouro || prev.address,
             neighborhood: data.bairro || prev.neighborhood,
             city: data.localidade || prev.city,
             state: data.uf || prev.state
           }));
        }
      } catch (err) {
        console.error("Erro ao buscar CEP", err);
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setForm({ ...form, photo: e.target.files[0] });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      let photoUrl = form.existingPhotoUrl;
      if (form.photo) {
        photoUrl = await compressImage(form.photo);
      }

      if (editingId) {
        const pathForUpdate = 'teams';
        try {
          await updateDoc(doc(db, pathForUpdate, editingId), {
            teamName: form.teamName,
            coach: form.coach,
            playerName: form.player,
            nickname: form.nickname,
            phone: form.phone,
            isWhatsapp: form.isWhatsapp,
            birthDate: form.birthDate,
            cep: form.cep,
            address: form.address,
            addressNumber: form.addressNumber,
            neighborhood: form.neighborhood,
            city: form.city,
            state: form.state,
            position: form.position,
            height: form.height,
            weight: form.weight,
            playerPhoto: photoUrl,
            updatedAt: serverTimestamp()
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, pathForUpdate);
        }
        alert('Ficha Atualizada!');
      } else {
        const pathForWrite = 'teams';
        const teamId = generateId();
        try {
          await setDoc(doc(db, pathForWrite, teamId), {
            ownerId: user.uid,
            teamName: form.teamName,
            coach: form.coach,
            playerName: form.player,
            nickname: form.nickname,
            phone: form.phone,
            isWhatsapp: form.isWhatsapp,
            birthDate: form.birthDate,
            cep: form.cep,
            address: form.address,
            addressNumber: form.addressNumber,
            neighborhood: form.neighborhood,
            city: form.city,
            state: form.state,
            position: form.position,
            height: form.height,
            weight: form.weight,
            playerPhoto: photoUrl,
            isVerified: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, pathForWrite);
        }
        alert('Ficha Registrada com Sucesso! Aguardando aprovação.');
      }

      setForm({
        teamName: '', coach: '', player: '', nickname: '', phone: '', isWhatsapp: false, birthDate: '', cep: '', address: '', addressNumber: '', neighborhood: '', city: '', state: '', position: '', height: '', weight: '', photo: null, existingPhotoUrl: '' 
      });
      setEditingId(null);
      setCurrentView('galeria');
    } catch (err: any) {
      console.error(err);
      let msg = err.message || String(err);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const filteredTeams = useMemo(() => {
    return teams.filter(t => {
      const matchCity = filterCity ? t.city?.toLowerCase().includes(filterCity.toLowerCase()) : true;
      const matchTeam = filterTeam ? t.teamName?.toLowerCase().includes(filterTeam.toLowerCase()) : true;
      const matchPosition = filterPosition ? t.position?.toLowerCase() === filterPosition.toLowerCase() : true;
      return matchCity && matchTeam && matchPosition;
    });
  }, [teams, filterCity, filterTeam, filterPosition]);

  return (
    <div className="min-h-screen bg-stone-100 font-sans text-stone-900 pb-12">
      {/* Header Style (Beach & Ocean Vibes) */}
      <nav className="bg-emerald-900 p-4 text-white shadow-md relative z-10 overflow-hidden border-b-4 border-yellow-500 print:hidden">
        <div className="absolute inset-0 z-0 bg-emerald-900">
          <img src="https://images.unsplash.com/photo-1544605481-64ffdc61922c?w=1600&q=80" className="w-full h-full object-cover opacity-20 mix-blend-overlay" alt="Beach Net" />
        </div>
        <div className="max-w-6xl mx-auto flex justify-between items-center relative z-10">
          <div className="flex items-center gap-6">
            <h1 className="text-2xl font-black flex items-center gap-2 uppercase tracking-wide">
              <Trophy className="text-orange-400" /> Beach Soccer
            </h1>
            {user && (
              <div className="hidden md:flex bg-emerald-900/60 p-1 rounded-xl backdrop-blur-sm border border-white/10">
                 <button 
                   onClick={() => setCurrentView('galeria')}
                   className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${currentView === 'galeria' ? 'bg-orange-500 shadow-sm' : 'hover:bg-emerald-700/50 text-emerald-100'}`}
                 >
                   <Users size={18} /> Elencos
                 </button>
                 <button 
                   onClick={() => setCurrentView('cadastro')}
                   className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${currentView === 'cadastro' ? 'bg-orange-500 shadow-sm' : 'hover:bg-emerald-700/50 text-emerald-100'}`}
                 >
                   <PlusCircle size={18} /> Nova Ficha
                 </button>
                 <button 
                   onClick={() => setCurrentView('squad')}
                   className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${currentView === 'squad' ? 'bg-orange-500 shadow-sm' : 'hover:bg-emerald-700/50 text-emerald-100'}`}
                 >
                   <Trophy size={18} /> Montar Time
                 </button>
              </div>
            )}
          </div>
          {user ? (
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-white drop-shadow-sm">{user.displayName}</p>
                <p className="text-xs text-emerald-100 mt-0.5">{user.email}</p>
              </div>
              {user.photoURL && (
                <img src={user.photoURL} alt="Avatar do Jogador" className="w-10 h-10 rounded-full border-2 border-orange-400 shadow-md object-cover flex-shrink-0" referrerPolicy="no-referrer" />
              )}
              <button
                onClick={handleLogout}
                className="bg-emerald-950/80 hover:bg-stone-900 px-3 py-2 rounded-lg flex items-center gap-2 transition-all border border-emerald-800 shadow-sm ml-2"
              >
                <LogOut size={16} /> <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              className="bg-orange-500 text-white px-5 py-2.5 rounded-lg font-bold hover:bg-orange-400 transition-colors shadow-md"
            >
              Entrar
            </button>
          )}
        </div>
      </nav>

      {/* Navegação Mobile */}
      {user && (
        <div className="md:hidden flex bg-emerald-900 p-2 shadow-inner gap-2 overflow-x-auto print:hidden">
           <button 
             onClick={() => setCurrentView('galeria')}
             className={`flex-none px-4 py-2.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 text-sm ${currentView === 'galeria' ? 'bg-orange-500 text-white shadow-sm' : 'bg-emerald-800 text-emerald-200 hover:bg-emerald-700'}`}
           >
             <Users size={16} /> Elencos
           </button>
           <button 
             onClick={() => setCurrentView('cadastro')}
             className={`flex-none px-4 py-2.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 text-sm ${currentView === 'cadastro' ? 'bg-orange-500 text-white shadow-sm' : 'bg-emerald-800 text-emerald-200 hover:bg-emerald-700'}`}
           >
             <PlusCircle size={16} /> Nova Ficha
           </button>
           <button 
             onClick={() => setCurrentView('squad')}
             className={`flex-none px-4 py-2.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 text-sm ${currentView === 'squad' ? 'bg-orange-500 text-white shadow-sm' : 'bg-emerald-800 text-emerald-200 hover:bg-emerald-700'}`}
           >
             <Trophy size={16} /> Montar Time
           </button>
        </div>
      )}

      <main className="max-w-6xl mx-auto p-4 md:p-6 mt-4">
        {!user ? (
          <div className="text-center py-24 px-4 bg-stone-900 rounded-[32px] shadow-2xl border border-stone-200/20 mt-10 relative overflow-hidden group">
            <div className="absolute inset-0 z-0">
              <img src="https://images.unsplash.com/photo-1587329310686-91414b8e3cb7?w=1600&q=80" className="w-full h-full object-cover opacity-50 group-hover:scale-105 transition-transform duration-700" alt="Soccer ball on beach" />
              <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/60 to-transparent"></div>
            </div>
            <div className="relative z-10">
              <Trophy size={80} className="mx-auto text-orange-400 mb-6 drop-shadow-lg" />
              <h2 className="text-4xl md:text-6xl font-black text-white mb-6 uppercase tracking-tight drop-shadow-md">O Maior Campeonato de Areia</h2>
              <p className="text-xl text-stone-200 mb-8 max-w-2xl mx-auto font-medium drop-shadow">
                Faça login para gerenciar seu clube, registrar atletas e acompanhar a galeria das feras do beach soccer!
              </p>
              <button
                onClick={handleLogin}
                className="bg-orange-500 text-white px-8 py-4 rounded-xl font-black text-lg hover:bg-orange-400 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 block mx-auto border-2 border-orange-400"
              >
                Começar Agora
              </button>
            </div>
          </div>
        ) : (
          <div>
            {currentView === 'cadastro' && (
              <div className="max-w-3xl mx-auto bg-white p-6 md:p-10 rounded-[32px] shadow-sm border border-emerald-100">
                <div className="flex items-center gap-4 mb-10">
                  <div className="bg-orange-100 p-4 rounded-2xl text-orange-600">
                    <PlusCircle size={32} />
                  </div>
                  <div>
                    <h2 className="text-3xl font-black text-emerald-900 leading-tight tracking-tight">{editingId ? 'Editar Ficha' : 'Ficha de Inscrição'}</h2>
                    <p className="text-stone-500 font-medium">Preencha os dados do atleta para avaliação</p>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-8">
                  {/* Informações do Clube */}
                  <div>
                    <h3 className="font-bold text-emerald-800 mb-4 flex items-center gap-2 uppercase tracking-wide text-sm border-b border-emerald-100 pb-2">Informações do Clube</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Clube / Time</label>
                        <input
                          className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-medium"
                          placeholder="Ex: Caiçara FC"
                          value={form.teamName}
                          onChange={(e) => setForm({ ...form, teamName: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Nome do Treinador</label>
                        <input
                          className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-medium"
                          placeholder="Ex: Prof. João"
                          value={form.coach}
                          onChange={(e) => setForm({ ...form, coach: e.target.value })}
                          required
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Dados do Atleta */}
                  <div>
                    <h3 className="font-bold text-orange-600 mb-4 flex items-center gap-2 uppercase tracking-wide text-sm border-b border-orange-100 pb-2">Dados do Atleta</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                      <div className="md:col-span-2">
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Nome Completo</label>
                        <input
                          className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                          placeholder="Ex: Carlos Oliveira Silva"
                          value={form.player}
                          onChange={(e) => setForm({ ...form, player: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Apelido</label>
                        <input
                          className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                          placeholder="Ex: Carlinhos"
                          value={form.nickname}
                          onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Telefone</label>
                        <input
                          className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                          placeholder="(11) 99999-9999"
                          value={form.phone}
                          onChange={handlePhoneChange}
                          maxLength={15}
                        />
                        <div className="mt-2 flex items-center gap-2 ml-1">
                          <input 
                            type="checkbox" 
                            id="isWhatsapp" 
                            checked={form.isWhatsapp} 
                            onChange={e => setForm({...form, isWhatsapp: e.target.checked})} 
                            className="w-4 h-4 text-orange-500 rounded focus:ring-orange-500" 
                          />
                          <label htmlFor="isWhatsapp" className="text-xs font-bold text-stone-500 cursor-pointer">É WhatsApp?</label>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Data de Nascimento</label>
                        <input
                          type="text"
                          className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium text-stone-700"
                          placeholder="DD/MM/AAAA"
                          value={form.birthDate}
                          onChange={handleBirthDateChange}
                        />
                      </div>
                      <div className="md:col-span-2 mt-4 pt-4 border-t border-stone-100">
                        <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">Endereço Residencial</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                          <div>
                            <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">CEP</label>
                            <input
                              type="text"
                              className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                              placeholder="00000-000"
                              value={form.cep}
                              onChange={handleCepChange}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Endereço (Rua/Av)</label>
                            <input
                              className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                              placeholder="Ex: Rua das Rosas"
                              value={form.address}
                              onChange={(e) => setForm({ ...form, address: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Número</label>
                            <input
                              className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                              placeholder="Ex: 123"
                              value={form.addressNumber}
                              onChange={(e) => setForm({ ...form, addressNumber: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Bairro</label>
                            <input
                              className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                              placeholder="Ex: Centro"
                              value={form.neighborhood}
                              onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Cidade</label>
                            <input
                              className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                              placeholder="Ex: Rio de Janeiro"
                              value={form.city}
                              onChange={(e) => setForm({ ...form, city: e.target.value })}
                            />
                          </div>
                          <div>
                            <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Estado (UF)</label>
                            <input
                              className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium uppercase"
                              placeholder="Ex: RJ"
                              maxLength={2}
                              value={form.state}
                              onChange={(e) => setForm({ ...form, state: e.target.value })}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5 mt-2">

                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Posição</label>
                        <select
                          className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium text-stone-700"
                          value={form.position}
                          onChange={(e) => setForm({ ...form, position: e.target.value })}
                        >
                          <option value="">Selecione...</option>
                          <option value="Goleiro">Goleiro</option>
                          <option value="Fixo">Fixo</option>
                          <option value="Ala">Ala</option>
                          <option value="Pivô">Pivô</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Altura (m)</label>
                        <input
                          className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                          placeholder="Ex: 1,83"
                          value={form.height}
                          onChange={handleHeightChange}
                        />
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Peso (kg)</label>
                        <input
                          className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                          placeholder="Ex: 78"
                          value={form.weight}
                          onChange={handleWeightChange}
                        />
                      </div>
                    </div>

                    {/* Foto */}
                    <div>
                      <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Foto de Rosto (Ficha)</label>
                      <label className="flex flex-col items-center justify-center gap-3 bg-stone-50 border-2 border-dashed border-stone-300 p-8 rounded-2xl cursor-pointer hover:bg-orange-50 hover:border-orange-300 transition-colors text-stone-500 group">
                        <Camera size={36} className="text-stone-400 group-hover:text-orange-500 transition-colors" />
                        <span className="text-sm font-bold text-center px-4">
                          {form.photo ? form.photo.name : (form.existingPhotoUrl ? 'Substituir foto atual?' : 'Clique para enviar foto. Prefira imagens claras do rosto.')}
                        </span>
                        <input
                          type="file"
                          className="hidden"
                          onChange={handleFile}
                          accept="image/*"
                        />
                      </label>
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="p-4 bg-red-50 text-red-700 text-sm rounded-xl border border-red-200 font-medium">
                      <b>Erro:</b> {errorMsg}
                    </div>
                  )}

                  <div className="border-t border-stone-100 pt-6 mt-4">
                    <button
                      className="w-full bg-emerald-800 text-white p-4 rounded-xl font-black text-lg uppercase tracking-wide hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md flex items-center justify-center gap-2"
                      disabled={loading}
                    >
                      {loading ? 'Processando Ficha...' : (editingId ? 'Atualizar Ficha' : 'Enviar Inscrição')}
                    </button>
                    {editingId && (
                      <button
                        type="button"
                        onClick={() => { setEditingId(null); setForm({ teamName: '', coach: '', player: '', nickname: '', phone: '', isWhatsapp: false, birthDate: '', cep: '', address: '', addressNumber: '', neighborhood: '', city: '', state: '', position: '', height: '', weight: '', photo: null, existingPhotoUrl: '' }); setCurrentView('galeria'); }}
                        className="mt-3 w-full text-stone-500 p-2 font-bold uppercase text-sm hover:text-stone-800 transition-colors"
                        disabled={loading}
                      >
                        Cancelar Edição
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )}

            {currentView === 'galeria' && (
              <div className="print:block">
                 <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4 print:hidden">
                    <div>
                      <h2 className="text-3xl lg:text-4xl font-black text-emerald-900 leading-tight uppercase tracking-tight">Galeria de Atletas</h2>
                      <p className="text-stone-500 font-medium mt-1">Conheça as estrelas dos clubes do torneio</p>
                    </div>
                    {user.email === 'allan.muniz88@gmail.com' && (
                      <div className="bg-amber-100 text-amber-800 px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 text-sm max-w-fit shadow-sm">
                        <ShieldCheck size={18} /> Admin
                      </div>
                    )}
                 </div>

                 {/* Filtros em Barras Modernas */}
                 <div className="bg-white p-5 rounded-[24px] flex flex-col md:flex-row gap-4 mb-8 shadow-sm border border-stone-200 justify-between items-center">
                   <div className="flex flex-wrap lg:flex-nowrap gap-4 w-full">
                     <div className="flex-1 min-w-[200px]">
                       <label className="text-xs font-bold text-stone-500 uppercase ml-1">Clube</label>
                       <div className="flex items-center gap-2 bg-stone-50 p-3 rounded-xl border border-stone-200 focus-within:border-emerald-500 focus-within:bg-white transition-all mt-1">
                         <Search size={18} className="text-stone-400" />
                         <input 
                           className="bg-transparent outline-none w-full text-sm font-medium" 
                           placeholder="Buscar por clube..." 
                           value={filterTeam}
                           onChange={e => setFilterTeam(e.target.value)}
                         />
                       </div>
                     </div>
                     <div className="flex-1 min-w-[200px]">
                       <label className="text-xs font-bold text-stone-500 uppercase ml-1">Cidade</label>
                       <div className="flex items-center gap-2 bg-stone-50 p-3 rounded-xl border border-stone-200 focus-within:border-emerald-500 focus-within:bg-white transition-all mt-1">
                         <MapPin size={18} className="text-stone-400" />
                         <input 
                           className="bg-transparent outline-none w-full text-sm font-medium" 
                           placeholder="Filtrar local..." 
                           value={filterCity}
                           onChange={e => setFilterCity(e.target.value)}
                         />
                       </div>
                     </div>
                     <div className="flex-1 min-w-[150px]">
                       <label className="text-xs font-bold text-stone-500 uppercase ml-1">Posição</label>
                       <select
                         className="w-full bg-stone-50 border border-stone-200 p-3 text-sm rounded-xl focus:border-emerald-500 focus:bg-white outline-none transition-all font-medium text-stone-700 mt-1"
                         value={filterPosition}
                         onChange={(e) => setFilterPosition(e.target.value)}
                       >
                         <option value="">Todas</option>
                         <option value="Goleiro">Goleiro</option>
                         <option value="Fixo">Fixo</option>
                         <option value="Ala">Ala</option>
                         <option value="Pivô">Pivô</option>
                       </select>
                     </div>
                   </div>

                   <div className="flex items-center gap-2 bg-stone-100 p-1.5 rounded-xl border border-stone-200 self-end md:self-auto w-full md:w-auto justify-center">
                     <button 
                       onClick={() => window.print()}
                       className="p-2.5 rounded-lg transition-all flex items-center justify-center text-stone-400 hover:text-stone-600 print:hidden hidden md:block border-r border-stone-200 mr-1 pr-3"
                       title="Imprimir Posições"
                     >
                       <Printer size={20} />
                     </button>
                     <button 
                       onClick={() => setViewMode('cards')}
                       className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${viewMode === 'cards' ? 'bg-white text-orange-500 shadow-sm' : 'text-stone-400 hover:text-stone-600'}`}
                       title="Ver em Cards"
                     >
                       <LayoutGrid size={20} />
                     </button>
                     <button 
                       onClick={() => setViewMode('table')}
                       className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${viewMode === 'table' ? 'bg-white text-orange-500 shadow-sm' : 'text-stone-400 hover:text-stone-600'}`}
                       title="Ver em Tabela"
                     >
                       <List size={20} />
                     </button>
                   </div>
                 </div>

                {filteredTeams.length === 0 ? (
                  <div className="bg-white text-center p-16 rounded-[32px] border border-stone-200 shadow-sm">
                    <Users size={64} className="mx-auto text-stone-200 mb-4" />
                    <p className="text-stone-500 font-bold text-xl">Nenhum atleta encontrado.</p>
                    <p className="text-stone-400 mt-2">Ajuste os filtros ou crie uma nova ficha.</p>
                  </div>
                ) : viewMode === 'cards' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredTeams.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => setSelectedPlayer(t)}
                        className="bg-white rounded-[24px] overflow-hidden shadow-sm hover:shadow-xl hover:ring-2 hover:ring-orange-500 cursor-pointer transition-all duration-300 border border-stone-200 flex flex-col relative group"
                      >
                        {!t.isVerified && (
                          <div className="absolute top-3 left-3 bg-stone-900/90 text-orange-400 text-[10px] uppercase font-black tracking-wider px-3 py-1.5 rounded-lg z-20 backdrop-blur-md border border-stone-700 shadow-lg">
                             Pendente
                          </div>
                        )}
                        
                        {/* Header: Club Info */}
                        <div className="bg-gradient-to-r from-emerald-900 to-emerald-800 text-white p-5 pb-10 relative flex justify-between items-start">
                           <div>
                             <p className="text-[10px] uppercase tracking-widest text-orange-400 font-bold mb-1">Clube Atual</p>
                             <h3 className="font-black text-lg leading-tight truncate max-w-[180px]" title={t.teamName}>{t.teamName}</h3>
                           </div>
                           {t.isVerified && <CheckCircle size={22} className="text-orange-400 drop-shadow-md" />}
                        </div>

                        {/* Player Image & Name Overlapping */}
                        <div className="px-5 relative -mt-10 flex flex-col items-center">
                           <div className="w-24 h-24 rounded-full border-4 border-white bg-stone-100 overflow-hidden shadow-md z-10 flex items-center justify-center relative">
                              {t.playerPhoto ? (
                                 <img src={t.playerPhoto} className={`w-full h-full object-cover ${!t.isVerified ? 'grayscale' : ''}`} alt={t.playerName} />
                              ) : (
                                 <Camera size={32} className="text-stone-300" />
                              )}
                           </div>
                           <h2 className="font-black text-[22px] text-emerald-950 mt-3 text-center leading-tight truncate w-full flex items-center justify-center gap-1">
                             {t.playerName}
                             {getBirthdayStatus(t.birthDate) === 'today' && <PartyPopper size={20} className="text-rose-500 animate-bounce flex-shrink-0" title="Aniversário Hoje!" />}
                             {getBirthdayStatus(t.birthDate) === 'upcoming' && <PartyPopper size={18} className="text-amber-500 flex-shrink-0" title="Aniversário chegando!" />}
                           </h2>
                           {t.nickname ? (
                             <p className="text-sm text-orange-600 font-bold mt-0.5 mb-2">"{t.nickname}"</p>
                           ) : (
                             <div className="h-6"></div>
                           )}
                           
                           {t.phone && (
                             <div className="flex items-center gap-1 text-xs text-stone-500 font-medium mb-1">
                               <Phone size={12} className={t.isWhatsapp ? "text-green-500" : "text-stone-400"} />
                               {t.phone} {t.isWhatsapp && <span className="text-[10px] text-green-600 font-bold ml-1">(WhatsApp)</span>}
                             </div>
                           )}
                        </div>

                        {/* Info Grid */}
                        <div className="px-5 pb-5 flex-1 flex flex-col">
                           <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm mt-2 mb-4 bg-stone-50 p-4 rounded-2xl border border-stone-100">
                              <div>
                                 <p className="text-[10px] uppercase font-bold text-stone-400">Posição</p>
                                 <p className="font-bold text-stone-800">{t.position || '-'}</p>
                              </div>
                              <div>
                                 <p className="text-[10px] uppercase font-bold text-stone-400">Cidade</p>
                                 <p className="font-bold text-stone-800 flex items-center gap-1"><MapPin size={12} className="text-emerald-500 opacity-70"/> <span className="truncate max-w-[80px]" title={t.city}>{t.city || '-'}</span></p>
                              </div>
                              <div>
                                 <p className="text-[10px] uppercase font-bold text-stone-400">Altura/Peso</p>
                                 <p className="font-bold text-stone-800">{t.height ? `${t.height}m` : '-'} / {t.weight ? `${t.weight}kg` : '-'}</p>
                              </div>
                              <div>
                                 <p className="text-[10px] uppercase font-bold text-stone-400">Nascimento</p>
                                 {t.birthDate ? (
                                    <p className="font-bold text-stone-800 flex items-center gap-1"><Calendar size={12} className="text-orange-500 opacity-70"/> {t.birthDate || '-'}</p>
                                 ) : (
                                    <p className="font-bold text-stone-800">-</p>
                                 )}
                              </div>
                           </div>
                           
                           {/* Área do Admin / Dono para gerenciar */}
                           <div className="mt-auto space-y-2 pt-2 border-t border-stone-100">
                             {!t.isVerified && (user.email === 'allan.muniz88@gmail.com') && (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleApprove(t.id); }}
                                  className="w-full bg-stone-900 text-orange-400 font-bold py-2.5 rounded-xl hover:bg-stone-800 transition-colors text-sm flex items-center justify-center gap-2"
                                >
                                  <ShieldCheck size={16} /> Aprovar Ficha
                                </button>
                             )}
                             
                             {!t.isVerified && t.ownerId === user.uid && user.email !== 'allan.muniz88@gmail.com' && (
                                <p className="text-center text-xs font-bold text-orange-600 bg-orange-50 p-2.5 rounded-xl border border-orange-100">
                                   Em validação pela mesa
                                </p>
                             )}

                             {t.ownerId === user.uid && (
                               <button
                                 onClick={(e) => { e.stopPropagation(); handleEdit(t); }}
                                 className="w-full bg-white text-emerald-700 font-bold py-2.5 rounded-xl border-2 border-emerald-100 hover:bg-emerald-50 hover:border-emerald-200 transition-colors text-xs flex items-center justify-center gap-2"
                               >
                                 <Edit size={14} /> Editar Ficha
                               </button>
                             )}
                           </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white rounded-[24px] shadow-sm border border-stone-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 uppercase text-xs font-black tracking-wider">
                            <th className="p-4">Atleta</th>
                            <th className="p-4">Clube</th>
                            <th className="p-4">Posição</th>
                            <th className="p-4">Local</th>
                            <th className="p-4">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {filteredTeams.map((t) => (
                            <tr key={t.id} onClick={() => setSelectedPlayer(t)} className="hover:bg-stone-50/50 cursor-pointer transition-colors">
                              <td className="p-4 min-w-[250px]">
                                <div className="flex items-center gap-4">
                                  <div className="w-12 h-12 rounded-full border border-stone-200 bg-stone-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
                                    {t.playerPhoto ? (
                                      <img src={t.playerPhoto} className={`w-full h-full object-cover ${!t.isVerified ? 'grayscale' : ''}`} alt={t.playerName} />
                                    ) : (
                                      <Camera size={20} className="text-stone-300" />
                                    )}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <p className="font-bold text-emerald-950 text-sm flex items-center gap-1">
                                         {t.playerName}
                                         {getBirthdayStatus(t.birthDate) === 'today' && <PartyPopper size={14} className="text-rose-500 animate-bounce flex-shrink-0" title="Aniversário Hoje!" />}
                                         {getBirthdayStatus(t.birthDate) === 'upcoming' && <PartyPopper size={14} className="text-amber-500 flex-shrink-0" title="Aniversário chegando!" />}
                                       </p>
                                      {!t.isVerified && <span className="bg-orange-100 text-orange-600 text-[9px] uppercase font-black px-2 py-0.5 rounded flex-shrink-0">Pendente</span>}
                                      {t.isVerified && <CheckCircle size={14} className="text-orange-400" />}
                                    </div>
                                    <p className="text-xs text-stone-500">{t.nickname ? `"${t.nickname}"` : t.birthDate ? t.birthDate : '-'}</p>
                                    {t.phone && (
                                      <p className="text-xs text-stone-500 mt-0.5 flex items-center gap-1">
                                        <Phone size={10} className={t.isWhatsapp ? "text-green-500" : "text-stone-400"} />
                                        {t.phone}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="p-4">
                                <p className="font-bold text-sm text-stone-800">{t.teamName}</p>
                              </td>
                              <td className="p-4">
                                <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-lg">{t.position || '-'}</span>
                              </td>
                              <td className="p-4 text-sm text-stone-600 font-medium">
                                <div className="flex flex-col">
                                  <span>{t.city || '-'}</span>
                                  <span className="text-xs text-stone-400">{t.state || '-'}</span>
                                </div>
                              </td>
                              <td className="p-4">
                                <div className="flex gap-2">
                                  {!t.isVerified && (user?.email === 'allan.muniz88@gmail.com') && (
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); handleApprove(t.id); }}
                                      className="bg-stone-900 text-orange-400 font-bold px-3 py-1.5 rounded-lg hover:bg-stone-800 transition-colors text-xs flex items-center justify-center gap-1 shadow-sm"
                                    >
                                      <ShieldCheck size={14} /> Aprovar
                                    </button>
                                  )}
                                  {t.ownerId === user?.uid && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleEdit(t); }}
                                      className="bg-white text-emerald-700 font-bold px-3 py-1.5 rounded-lg border border-emerald-100 hover:bg-emerald-50 transition-colors text-xs flex items-center justify-center gap-1 shadow-sm"
                                    >
                                      <Edit size={14} /> Editar
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
            {currentView === 'squad' && (
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
                  <div>
                    <h2 className="text-3xl font-black text-emerald-900 tracking-tight flex items-center gap-2">
                       <Trophy className="text-orange-500" /> Montar Time
                    </h2>
                    <p className="text-stone-500 font-medium">Selecione atletas para montar um elenco e imprima a escalação.</p>
                  </div>
                  <div className="flex gap-3 print:hidden">
                    <button 
                      onClick={() => setSelectedSquadPlayers([])}
                      className="px-4 py-2 font-bold text-stone-500 hover:text-stone-800 transition-colors"
                      disabled={selectedSquadPlayers.length === 0}
                    >
                      Limpar
                    </button>
                    <button 
                      onClick={() => window.print()}
                      className="bg-orange-500 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-orange-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={selectedSquadPlayers.length === 0}
                    >
                      <Printer size={18} /> Imprimir / PDF
                    </button>
                  </div>
                </div>

                <div className="grid grid-flow-row md:grid-cols-3 gap-8">
                  {/* Left Column - Library */}
                  <div className="md:col-span-1 print:hidden bg-white p-4 rounded-2xl border border-stone-200 h-[600px] flex flex-col">
                    <h3 className="font-bold text-sm uppercase text-stone-500 mb-4 px-2">Atletas Disponíveis</h3>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                      {filteredTeams.map(t => (
                        <div 
                          key={t.id} 
                          className="flex items-center justify-between p-3 bg-stone-50 hover:bg-stone-100 rounded-xl cursor-pointer border border-transparent hover:border-stone-200 transition-colors"
                          onClick={() => {
                            if (!selectedSquadPlayers.find(p => p.id === t.id)) {
                              setSelectedSquadPlayers([...selectedSquadPlayers, t]);
                            }
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-stone-200 overflow-hidden border border-stone-300 flex-shrink-0 flex items-center justify-center">
                              {t.playerPhoto ? <img src={t.playerPhoto} className="w-full h-full object-cover" /> : <Camera size={16} className="text-stone-400" />}
                            </div>
                            <div>
                               <p className="font-bold text-sm text-stone-800 leading-tight">{t.playerName}</p>
                               <p className="text-[10px] uppercase font-bold text-stone-400">{t.position || 'Sem POS'}</p>
                            </div>
                          </div>
                          <PlusCircle size={18} className="text-emerald-600 opacity-50" />
                        </div>
                      ))}
                      {filteredTeams.length === 0 && (
                        <p className="text-center text-sm text-stone-400 py-6">Nenhum atleta encontrado.</p>
                      )}
                    </div>
                  </div>

                  {/* Right Column - Squad Sheet */}
                  <div className="md:col-span-2 bg-white rounded-3xl border border-stone-200 shadow-sm p-6 md:p-8 min-h-[600px]">
                    <div className="text-center mb-8 border-b-2 border-stone-100 pb-6 print:border-stone-800">
                      <h4 className="text-2xl font-black uppercase text-stone-800 tracking-wider">Escalação Oficial</h4>
                      <p className="text-stone-500 font-medium">Beach Soccer - {new Date().toLocaleDateString('pt-BR')}</p>
                    </div>

                    {selectedSquadPlayers.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-64 text-stone-300 print:hidden">
                        <Users size={64} className="mb-4" />
                        <p className="font-bold text-lg">Selecione atletas na lista ao lado</p>
                        <p className="text-sm">Eles aparecerão aqui para o seu time.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {selectedSquadPlayers.map((player, idx) => (
                          <div key={player.id} className="flex items-center gap-4 p-4 border border-stone-200 rounded-xl relative group print:border-b print:border-black print:rounded-none">
                            <div className="font-black text-2xl text-stone-200 w-8 text-center print:text-black">{idx + 1}</div>
                            <div className="w-12 h-12 rounded-full border border-stone-300 bg-stone-100 overflow-hidden flex-shrink-0 flex items-center justify-center print:w-16 print:h-16">
                              {player.playerPhoto ? <img src={player.playerPhoto} className="w-full h-full object-cover" /> : <Camera size={20} className="text-stone-400" />}
                            </div>
                            <div className="flex-1">
                               <p className="font-black text-lg text-stone-800 leading-none">{player.playerName}</p>
                               <span className="text-xs uppercase font-bold text-stone-500 mr-3">{player.position || '-'}</span>
                               {player.nickname && <span className="text-xs text-orange-500 font-bold">"{player.nickname}"</span>}
                            </div>
                            <div className="text-right hidden sm:block print:block">
                               <p className="text-[10px] uppercase font-bold text-stone-400">Time / Clube</p>
                               <p className="font-bold text-sm text-stone-700">{player.teamName}</p>
                            </div>
                            <button 
                              onClick={() => setSelectedSquadPlayers(selectedSquadPlayers.filter(p => p.id !== player.id))}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity print:hidden shadow-sm"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Expanded Details Modal */}
      {selectedPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/80 backdrop-blur-sm shadow-2xl transition-opacity animate-in fade-in duration-300">
          <div className="bg-white rounded-[32px] w-full max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden flex flex-col relative animate-in zoom-in-95 duration-300">
            <button 
              onClick={() => setSelectedPlayer(null)}
              className="absolute top-6 right-6 bg-stone-100 hover:bg-stone-200 text-stone-600 p-2 rounded-full transition-colors z-20 print:hidden"
            >
              <X size={24} />
            </button>
            
            {/* Header Modal */}
            <div className="bg-gradient-to-r from-emerald-900 to-emerald-800 p-8 pb-32 relative text-white">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] uppercase font-bold tracking-widest text-orange-400 mb-2">Detalhes do Atleta</p>
                  <h3 className="text-4xl font-black">{selectedPlayer.playerName}</h3>
                  {selectedPlayer.nickname && <p className="text-orange-400 font-bold text-xl mt-1">"{selectedPlayer.nickname}"</p>}
                </div>
                <button 
                  onClick={() => window.print()} 
                  className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl transition-colors print:hidden flex items-center gap-2 font-bold text-sm"
                  title="Imprimir Ficha"
                >
                  <Printer size={18} /> Imprimir / PDF
                </button>
              </div>
            </div>

            <div className="px-8 pb-8 relative -mt-24">
              <div className="flex flex-col md:flex-row gap-8 items-start">
                  <div className="w-40 h-40 rounded-full border-4 border-white bg-stone-100 overflow-hidden shadow-xl z-10 flex items-center justify-center relative flex-shrink-0">
                      {selectedPlayer.playerPhoto ? (
                        <img src={selectedPlayer.playerPhoto} className={`w-full h-full object-cover ${!selectedPlayer.isVerified ? 'grayscale' : ''}`} alt={selectedPlayer.playerName} />
                      ) : (
                        <Camera size={48} className="text-stone-300" />
                      )}
                  </div>

                  <div className="flex-1 w-full bg-white rounded-2xl shadow-sm border border-stone-100 p-6 md:mt-16">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8">
                          <div>
                              <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Equipe Atual</p>
                              <p className="font-black text-2xl text-stone-800 leading-tight">{selectedPlayer.teamName}</p>
                          </div>
                          <div>
                              <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Treinador</p>
                              <p className="font-bold text-lg text-stone-700">{selectedPlayer.coach || '-'}</p>
                          </div>

                          <div className="md:col-span-2 border-t border-stone-100 pt-6">
                              <h4 className="text-sm font-black text-emerald-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <Activity size={18} className="text-orange-500" /> Ficha Técnica
                              </h4>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                  <div className="bg-stone-50 p-4 rounded-xl border border-stone-100">
                                    <p className="text-[10px] uppercase font-bold text-stone-400">Posição</p>
                                    <p className="font-black text-stone-800 mt-1">{selectedPlayer.position || '-'}</p>
                                  </div>
                                  <div className="bg-stone-50 p-4 rounded-xl border border-stone-100">
                                    <p className="text-[10px] uppercase font-bold text-stone-400">Nascimento</p>
                                    <p className="font-black text-stone-800 mt-1">{selectedPlayer.birthDate || '-'}</p>
                                  </div>
                                  <div className="bg-stone-50 p-4 rounded-xl border border-stone-100">
                                    <p className="text-[10px] uppercase font-bold text-stone-400">Altura</p>
                                    <p className="font-black text-stone-800 mt-1">{selectedPlayer.height ? `${selectedPlayer.height}m` : '-'}</p>
                                  </div>
                                  <div className="bg-stone-50 p-4 rounded-xl border border-stone-100">
                                    <p className="text-[10px] uppercase font-bold text-stone-400">Peso</p>
                                    <p className="font-black text-stone-800 mt-1">{selectedPlayer.weight ? `${selectedPlayer.weight}kg` : '-'}</p>
                                  </div>
                              </div>
                          </div>

                          <div className="md:col-span-2 border-t border-stone-100 pt-6">
                              <h4 className="text-sm font-black text-emerald-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <MapPin size={18} className="text-orange-500" /> Contato e Endereço
                              </h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="bg-stone-50 p-4 rounded-xl border border-stone-100 flex flex-col gap-1 shrink-0">
                                    <p className="text-[10px] uppercase font-bold text-stone-400 flex items-center gap-1">
                                      <Phone size={12} className={selectedPlayer.isWhatsapp ? "text-green-500" : "text-stone-400"} />
                                      Telefone
                                    </p>
                                    <p className="font-bold text-stone-800 text-lg">
                                      {selectedPlayer.phone || '-'}
                                      {selectedPlayer.isWhatsapp && <span className="ml-2 text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-black uppercase inline-block align-middle">WhatsApp</span>}
                                    </p>
                                  </div>
                                  <div className="bg-stone-50 p-4 rounded-xl border border-stone-100 flex flex-col gap-1">
                                    <p className="text-[10px] uppercase font-bold text-stone-400 leading-tight">Endereço Completo</p>
                                    <p className="font-bold text-stone-800 text-sm leading-snug">
                                        {selectedPlayer.address ? (
                                          <>
                                            {selectedPlayer.address}, {selectedPlayer.addressNumber || 'S/N'}<br/>
                                            {selectedPlayer.neighborhood && <>{selectedPlayer.neighborhood}<br/></>}
                                            {selectedPlayer.city} - {selectedPlayer.state}<br/>
                                            CEP: {selectedPlayer.cep}
                                          </>
                                        ) : (
                                          <>{selectedPlayer.city ? `${selectedPlayer.city} - ${selectedPlayer.state}` : '-'}</>
                                        )}
                                    </p>
                                  </div>
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
              
              {(selectedPlayer.ownerId === user?.uid || (!selectedPlayer.isVerified && user?.email === 'allan.muniz88@gmail.com')) && (
                <div className="mt-8 flex justify-end gap-3 border-t border-stone-100 pt-6 print:hidden">
                    {!selectedPlayer.isVerified && (user?.email === 'allan.muniz88@gmail.com') && (
                      <button 
                        onClick={() => { handleApprove(selectedPlayer.id); setSelectedPlayer(null); }}
                        className="bg-stone-900 text-orange-400 font-bold px-6 py-3 rounded-xl hover:bg-stone-800 transition-colors text-sm flex items-center justify-center gap-2 shadow-sm"
                      >
                        <ShieldCheck size={18} /> Aprovar Ficha
                      </button>
                    )}
                    {selectedPlayer.ownerId === user?.uid && (
                      <button
                        onClick={() => { handleEdit(selectedPlayer); setSelectedPlayer(null); }}
                        className="bg-white text-emerald-700 font-bold px-6 py-3 rounded-xl border border-emerald-100 hover:bg-emerald-50 transition-colors text-sm flex items-center justify-center gap-2 shadow-sm"
                      >
                        <Edit size={18} /> Editar Cadastro
                      </button>
                    )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
