import { useState, useEffect } from 'react';
import { db, storage, auth } from './firebase';
import { collection, doc, setDoc, onSnapshot, query, where, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Trophy, Camera, CheckCircle, LogOut, Users, PlusCircle, ShieldCheck, Edit } from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth';

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
        const MAX_WIDTH = 250;
        const MAX_HEIGHT = 250;
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
        // Returns base64 string
        resolve(canvas.toDataURL('image/jpeg', 0.6));
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
  const [currentView, setCurrentView] = useState<'cadastro' | 'galeria'>('galeria');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    teamName: '',
    coach: '',
    player: '',
    photo: null as File | null,
    existingPhotoUrl: ''
  });

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
      teamName: team.teamName,
      coach: team.coach,
      player: team.playerName,
      photo: null,
      existingPhotoUrl: team.playerPhoto || ''
    });
    setEditingId(team.id);
    setCurrentView('cadastro');
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
            playerPhoto: photoUrl,
            updatedAt: serverTimestamp()
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, pathForUpdate);
        }
        alert('Cadastro Atualizado!');
      } else {
        const pathForWrite = 'teams';
        const teamId = generateId();
        try {
          await setDoc(doc(db, pathForWrite, teamId), {
            ownerId: user.uid,
            teamName: form.teamName,
            coach: form.coach,
            playerName: form.player,
            playerPhoto: photoUrl,
            isVerified: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, pathForWrite);
        }
        alert('Cadastro Realizado!');
      }

      setForm({ teamName: '', coach: '', player: '', photo: null, existingPhotoUrl: '' });
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

  return (
    <div className="min-h-screen bg-stone-100 font-sans text-stone-900 pb-12">
      <nav className="bg-sky-700 p-4 text-white shadow-md relative z-10">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6">
            <h1 className="text-2xl font-black flex items-center gap-2 uppercase tracking-wide">
              <Trophy className="text-amber-400" /> Beach Soccer
            </h1>
            {user && (
              <div className="hidden md:flex bg-sky-800/50 p-1 rounded-xl">
                 <button 
                   onClick={() => setCurrentView('galeria')}
                   className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${currentView === 'galeria' ? 'bg-sky-600 shadow-sm' : 'hover:bg-sky-600/50 text-sky-200'}`}
                 >
                   <Users size={18} /> Elencos
                 </button>
                 <button 
                   onClick={() => setCurrentView('cadastro')}
                   className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${currentView === 'cadastro' ? 'bg-sky-600 shadow-sm' : 'hover:bg-sky-600/50 text-sky-200'}`}
                 >
                   <PlusCircle size={18} /> Novo Cadastro
                 </button>
              </div>
            )}
          </div>
          {user ? (
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold">{user.displayName}</p>
                <p className="text-xs text-sky-200">{user.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="bg-sky-900 hover:bg-stone-900 px-3 py-2 rounded-lg flex items-center gap-2 transition-all shadow-sm"
              >
                <LogOut size={16} /> <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              className="bg-amber-500 text-stone-900 px-5 py-2.5 rounded-lg font-bold hover:bg-amber-400 transition-colors shadow-md"
            >
              Entrar
            </button>
          )}
        </div>
      </nav>

      {/* Navegação Mobile */}
      {user && (
        <div className="md:hidden flex bg-sky-800 p-2 shadow-inner">
           <button 
             onClick={() => setCurrentView('galeria')}
             className={`flex-1 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm ${currentView === 'galeria' ? 'bg-sky-600 text-white shadow-sm' : 'text-sky-200'}`}
           >
             <Users size={16} /> Elencos
           </button>
           <button 
             onClick={() => setCurrentView('cadastro')}
             className={`flex-1 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm ${currentView === 'cadastro' ? 'bg-sky-600 text-white shadow-sm' : 'text-sky-200'}`}
           >
             <PlusCircle size={16} /> Novo Cadastro
           </button>
        </div>
      )}

      <main className="max-w-6xl mx-auto p-4 md:p-6 mt-4">
        {!user ? (
          <div className="text-center py-20 px-4 bg-white rounded-3xl shadow-sm border border-stone-200">
            <Trophy size={64} className="mx-auto text-amber-500 mb-6" />
            <h2 className="text-3xl md:text-5xl font-black text-sky-900 mb-6 uppercase tracking-tight">O Maior Campeonato de Areia</h2>
            <p className="text-lg text-stone-600 mb-8 max-w-2xl mx-auto">
              Faça login para escalar o seu elenco, registrar seus craques e acompanhar a galeria dos melhores jogadores das praias!
            </p>
            <button
              onClick={handleLogin}
              className="bg-amber-500 text-stone-900 px-8 py-4 rounded-xl font-bold text-lg hover:bg-amber-400 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1"
            >
              Começar Agora
            </button>
          </div>
        ) : (
          <div>
            {currentView === 'cadastro' && (
              <div className="max-w-xl mx-auto bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-stone-200">
                <div className="flex items-center gap-3 mb-8">
                  <div className="bg-sky-100 p-3 rounded-2xl text-sky-600">
                    <PlusCircle size={24} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-sky-900 leading-tight">{editingId ? 'Editar Cadastro' : 'Novo Cadastro'}</h2>
                    <p className="text-stone-500 text-sm">Insira os dados do time e do jogador principal</p>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-bold text-stone-600 mb-1.5 ml-1">Nome do Time</label>
                      <input
                        className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-amber-500 focus:bg-white outline-none transition-all font-medium"
                        placeholder="Ex: Caiçara FC"
                        value={form.teamName}
                        onChange={(e) => setForm({ ...form, teamName: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-stone-600 mb-1.5 ml-1">Treinador</label>
                      <input
                        className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-amber-500 focus:bg-white outline-none transition-all font-medium"
                        placeholder="Ex: Prof. João"
                        value={form.coach}
                        onChange={(e) => setForm({ ...form, coach: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  
                  <div className="bg-stone-50 p-5 rounded-2xl border border-stone-200">
                    <h3 className="font-bold text-stone-800 mb-4 flex items-center gap-2"><Trophy size={16} className="text-amber-500"/> Jogador Destaque</h3>
                    <div>
                      <label className="block text-sm font-bold text-stone-600 mb-1.5 ml-1">Nome do Jogador</label>
                      <input
                        className="w-full bg-white border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none transition-all font-medium mb-4"
                        placeholder="Ex: Carlos Silva"
                        value={form.player}
                        onChange={(e) => setForm({ ...form, player: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-stone-600 mb-1.5 ml-1">Foto do Jogador</label>
                      <label className="flex flex-col items-center justify-center gap-2 bg-white border-2 border-dashed border-stone-300 p-6 rounded-xl cursor-pointer hover:bg-sky-50 hover:border-sky-300 transition-colors text-stone-500 group">
                        <Camera size={28} className="text-stone-400 group-hover:text-sky-500 transition-colors" />
                        <span className="text-sm font-bold text-center">
                          {form.photo ? form.photo.name : 'Clique para selecionar uma imagem (até 2MB)'}
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
                  <button
                    className="mt-2 w-full bg-sky-600 text-white p-4 rounded-xl font-black text-lg uppercase tracking-wide hover:bg-sky-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                    disabled={loading}
                  >
                    {loading ? 'Adicionando Jogador...' : (editingId ? 'Salvar Alterações' : 'Criar Jogador')}
                  </button>
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => { setEditingId(null); setForm({ teamName: '', coach: '', player: '', photo: null, existingPhotoUrl: ''}); setCurrentView('galeria'); }}
                      className="mt-1 w-full text-stone-500 p-2 font-bold uppercase text-sm hover:text-stone-700 transition-colors"
                      disabled={loading}
                    >
                      Cancelar Edição
                    </button>
                  )}
                </form>
              </div>
            )}

            {currentView === 'galeria' && (
              <div>
                 <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                    <div>
                      <h2 className="text-3xl font-black text-sky-900 leading-tight uppercase">Galeria de Atletas</h2>
                      <p className="text-stone-500 font-medium">Jogadores verificados e ativos no campeonato</p>
                    </div>
                    
                    {user.email === 'allan.muniz88@gmail.com' && (
                      <div className="bg-amber-100 text-amber-800 px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm">
                        <ShieldCheck size={18} /> Modo Administrador
                      </div>
                    )}
                 </div>

                {teams.length === 0 ? (
                  <div className="bg-white text-center p-12 rounded-3xl border border-stone-200 shadow-sm">
                    <Trophy size={48} className="mx-auto text-stone-300 mb-4" />
                    <p className="text-stone-500 font-bold text-lg">Nenhum jogador na galeria ainda.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {teams.map((t) => (
                      <div
                        key={t.id}
                        className="bg-white rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-shadow border border-stone-200 flex flex-col relative"
                      >
                        {!t.isVerified && (
                          <div className="absolute top-3 left-3 bg-stone-900/80 text-amber-400 text-xs font-bold px-3 py-1.5 rounded-lg z-10 backdrop-blur-sm border border-stone-700">
                             EM ANÁLISE
                          </div>
                        )}
                        
                        <div className="aspect-square bg-stone-100 flex items-center justify-center overflow-hidden relative">
                           {t.playerPhoto ? (
                             <img
                               src={t.playerPhoto}
                               alt={t.playerName}
                               className={`w-full h-full object-cover transition-transform duration-500 hover:scale-105 ${!t.isVerified ? 'grayscale opacity-70' : ''}`}
                             />
                           ) : (
                             <div className="text-stone-300 flex flex-col items-center">
                               <Camera size={48} />
                               <span className="font-bold text-sm mt-2">Sem Foto</span>
                             </div>
                           )}
                           <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-stone-900/80 to-transparent p-4 pt-12">
                             <h3 className="text-white font-black text-xl truncate">{t.playerName}</h3>
                           </div>
                        </div>

                        <div className="p-5 flex-1 flex flex-col">
                          <div className="mb-4">
                            <p className="text-xs font-bold uppercase text-stone-400 mb-1">Equipe</p>
                            <p className="font-bold text-stone-800 flex items-center justify-between">
                              {t.teamName}
                              {t.isVerified && <CheckCircle size={16} className="text-emerald-500" />}
                            </p>
                          </div>
                          <div className="mb-4">
                            <p className="text-xs font-bold uppercase text-stone-400 mb-1">Treinador(a)</p>
                            <p className="font-medium text-stone-700 text-sm">{t.coach}</p>
                          </div>
                          
                          {/* Área do Admin / Dono para gerenciar */}
                          <div className="border-t border-stone-100 pt-4 mt-auto space-y-2">
                            {!t.isVerified && (user.email === 'allan.muniz88@gmail.com') && (
                               <button 
                                 onClick={() => handleApprove(t.id)}
                                 className="w-full bg-stone-900 text-amber-400 font-bold py-2.5 rounded-xl hover:bg-stone-800 transition-colors text-sm flex items-center justify-center gap-2"
                               >
                                 <ShieldCheck size={16} /> Aprovar Jogador
                               </button>
                            )}
                            
                            {!t.isVerified && t.ownerId === user.uid && user.email !== 'allan.muniz88@gmail.com' && (
                               <p className="text-center text-xs font-bold text-amber-600 bg-amber-50 p-2 rounded-lg">
                                  Aguardando aprovação da moderação
                               </p>
                            )}

                            {t.ownerId === user.uid && (
                              <button
                                onClick={() => handleEdit(t)}
                                className="w-full bg-sky-50 text-sky-700 font-bold py-2 rounded-xl border border-sky-200 hover:bg-sky-100 transition-colors text-xs flex items-center justify-center gap-2"
                              >
                                <Edit size={14} /> Editar Atleta
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

