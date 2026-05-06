import { useState, useEffect } from 'react';
import { db, storage, auth } from './firebase';
import { collection, doc, setDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore';
import { Trophy, Camera, CheckCircle, LogOut } from 'lucide-react';
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
  const [form, setForm] = useState({
    teamName: '',
    coach: '',
    player: '',
    photo: null as File | null
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || (!user.emailVerified && !user.isAnonymous)) {
       setTeams([]);
       return;
    }

    const pathForOnSnapshot = 'teams';
    // query public or owned records
    const q = query(
      collection(db, pathForOnSnapshot)
    );
    // Actually our rules say we can list if isVerified == true or ownerId == uid.
    // A single query cannot fetch (isVerified == true OR ownerId == uid) easily without composite indexes or multiple queries.
    // For simplicity, let's query where isVerified == true.
    const qVerified = query(collection(db, pathForOnSnapshot), where('isVerified', '==', true));
    
    // We should also get owner's unverified teams
    const qOwned = query(collection(db, pathForOnSnapshot), where('ownerId', '==', user.uid));

    const unsubscribeVerified = onSnapshot(qVerified, (snapshot) => {
      const verifiedTeams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTeams(prev => {
        const others = prev.filter(p => p.ownerId === user.uid); 
        // merging uniqueness by id
        const merged = [...verifiedTeams, ...others].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
        return merged;
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, pathForOnSnapshot));

    const unsubscribeOwned = onSnapshot(qOwned, (snapshot) => {
      const ownedTeams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTeams(prev => {
        const others = prev.filter(p => p.ownerId !== user.uid);
        // merging uniqueness by id
        const merged = [...others, ...ownedTeams].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
        return merged;
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, pathForOnSnapshot));

    return () => {
      unsubscribeVerified();
      unsubscribeOwned();
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
      let photoUrl = '';
      if (form.photo) {
        photoUrl = await compressImage(form.photo);
      }

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
      setForm({ teamName: '', coach: '', player: '', photo: null });
    } catch (err: any) {
      console.error(err);
      let msg = err.message || String(err);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-amber-50 font-sans text-stone-900">
      <nav className="bg-sky-600 p-4 text-white flex justify-between items-center shadow-lg">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Trophy /> Beach Soccer League
        </h1>
        {user ? (
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">{user.displayName}</span>
            <button
              onClick={handleLogout}
              className="bg-sky-700 hover:bg-sky-800 px-3 py-1.5 rounded-lg flex items-center gap-2 transition-colors"
            >
              <LogOut size={16} /> Sair
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogin}
            className="bg-white text-sky-600 px-4 py-2 rounded-lg font-bold hover:bg-sky-50 transition-colors"
          >
            Entrar com Google
          </button>
        )}
      </nav>

      <main className="max-w-5xl mx-auto p-6 mt-8">
        {!user ? (
          <div className="text-center py-20">
            <h2 className="text-3xl font-bold text-sky-900 mb-4">Bem-vindo ao Beach Soccer Manager</h2>
            <p className="text-lg text-stone-600 mb-8 items-center max-w-xl mx-auto">
              Faça login para cadastrar o seu time, treinar jogadores e acompanhar verificações no maior campeonato de futebol de areia!
            </p>
            <button
              onClick={handleLogin}
              className="bg-orange-500 text-white px-8 py-3 rounded-xl font-bold text-lg hover:bg-orange-600 transition-colors shadow-md hover:shadow-lg"
            >
              Começar Agora
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <section className="bg-white p-8 rounded-2xl shadow-sm border border-orange-100 lg:col-span-1 h-fit">
              <h2 className="text-xl font-bold mb-6 text-sky-900">Novo Cadastro</h2>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Nome do Time</label>
                  <input
                    className="w-full border border-stone-200 p-2.5 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                    placeholder="Ex: Caiçara FC"
                    value={form.teamName}
                    onChange={(e) => setForm({ ...form, teamName: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Treinador</label>
                  <input
                    className="w-full border border-stone-200 p-2.5 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                    placeholder="Ex: Professor João"
                    value={form.coach}
                    onChange={(e) => setForm({ ...form, coach: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Nome do Jogador Principal</label>
                  <input
                    className="w-full border border-stone-200 p-2.5 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                    placeholder="Ex: Carlos Silva"
                    value={form.player}
                    onChange={(e) => setForm({ ...form, player: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-600 mb-1">Foto do Jogador</label>
                  <label className="flex items-center justify-center gap-2 border-2 border-dashed border-stone-300 p-4 rounded-xl cursor-pointer hover:bg-stone-50 transition-colors text-stone-500 hover:text-stone-700">
                    <Camera size={20} />
                    <span className="text-sm font-medium">
                      {form.photo ? form.photo.name : 'Selecionar imagem'}
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      onChange={handleFile}
                      accept="image/*"
                    />
                  </label>
                </div>
                {errorMsg && (
                  <div className="p-3 bg-red-50 text-red-700 text-sm rounded-xl border border-red-200">
                    <b>Erro:</b> {errorMsg}
                  </div>
                )}
                <button
                  className="mt-4 w-full bg-orange-500 text-white p-3.5 rounded-xl font-bold hover:bg-orange-600 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
                  disabled={loading}
                >
                  {loading ? 'Enviando...' : 'Registrar Time'}
                </button>
              </form>
            </section>

            <section className="lg:col-span-2">
              <h2 className="text-xl font-bold mb-6 text-sky-900 flex items-center gap-2">
                Times Verificados & Pendentes
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {teams.length === 0 ? (
                  <div className="col-span-full bg-white/60 text-center p-8 rounded-2xl border border-stone-200/60">
                    <p className="text-stone-500 font-medium">Nenhum time registrado ainda.</p>
                  </div>
                ) : (
                  teams.map((t) => (
                    <div
                      key={t.id}
                      className="bg-white p-5 rounded-2xl shadow-sm border border-stone-100 flex flex-col justify-between gap-4 transition-all hover:shadow-md h-full relative overflow-hidden"
                    >
                      <div className={`absolute top-0 left-0 w-1.5 h-full ${t.isVerified ? 'bg-emerald-500' : 'bg-amber-400'}`}></div>
                      
                      <div className="flex gap-4 items-start pl-2">
                        {t.playerPhoto ? (
                          <img
                            src={t.playerPhoto}
                            alt="Player"
                            className="w-16 h-16 rounded-full object-cover shadow-sm border border-stone-100 object-center"
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-400">
                            <Camera size={24} />
                          </div>
                        )}
                        <div>
                          <h3 className="font-bold text-lg text-stone-800 leading-tight">{t.teamName}</h3>
                          <p className="text-stone-500 text-sm mt-1">Téc: {t.coach}</p>
                          <p className="text-sm font-medium text-sky-700 mt-2 flex items-center gap-1.5">
                            Jogador: {t.playerName}
                          </p>
                        </div>
                      </div>
                      
                      <div className="pl-2 flex items-center gap-1.5 mt-2">
                         {t.isVerified ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-full">
                              <CheckCircle size={14} /> Equipe Verificada
                            </span>
                         ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-amber-50 text-amber-600 rounded-full">
                              Em Análise
                            </span>
                         )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

