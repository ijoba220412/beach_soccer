import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from './firebase';
import { 
  collection, doc, setDoc, onSnapshot, query, where, serverTimestamp, 
  updateDoc, getDoc, getDocs, deleteDoc 
} from 'firebase/firestore';
import { 
  Trophy, Camera, CheckCircle, LogOut, Users, PlusCircle, ShieldCheck, Edit, 
  MapPin, Search, Calendar, Phone, Activity, LayoutGrid, List, X, Printer, 
  PartyPopper, Ticket, UserCheck, UserX, UserPlus, Key, Lock, Eye, EyeOff,
  ShieldAlert, Trash2, Copy, Clock, Mail, ArrowLeft
} from 'lucide-react';
import { 
  signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile
} from 'firebase/auth';

// ============ UTILITÁRIOS ============

const calculateAge = (birthDate: string | undefined): number | null => {
  if (!birthDate || birthDate.length !== 10) return null;
  const [day, month, year] = birthDate.split('/');
  if (!day || !month || !year) return null;
  const birth = new Date(Number(year), Number(month) - 1, Number(day));
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
};

const getBirthdayStatus = (dateStr: string | undefined): 'today' | 'upcoming' | null => {
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

const getCategoryFromAge = (age: number | null): 'sub17' | 'sub20' | 'profissional' | null => {
  if (age === null) return null;
  if (age <= 17) return 'sub17';
  if (age >= 18 && age <= 20) return 'sub20';
  return 'profissional';
};

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Gera código de convite único no formato INV-XXXXXXXX
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'INV-';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const SUPER_ADMIN_EMAIL = 'beachsoccerrafaelcobra@gmail.com';

enum OperationType {
  CREATE = 'create', UPDATE = 'update', DELETE = 'delete',
  LIST = 'list', GET = 'get', WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(error instanceof Error ? error.message : String(error));
}

const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 400;
          const MAX_HEIGHT = 400;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height = Math.round(height * (MAX_WIDTH / width));
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width = Math.round(width * (MAX_HEIGHT / height));
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Canvas context not available'));
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
  });
};

// ============ TIPOS ============

interface PlayerData {
  id: string;
  ownerId?: string;
  teamName?: string;
  coach?: string;
  playerName?: string;
  nickname?: string;
  phone?: string;
  isWhatsapp?: boolean;
  birthDate?: string;
  cep?: string;
  address?: string;
  addressNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  position?: string;
  height?: string;
  weight?: string;
  playerPhoto?: string;
  isVerified?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

interface FormData {
  teamName: string; coach: string; player: string; nickname: string;
  phone: string; isWhatsapp: boolean; birthDate: string; cep: string;
  address: string; addressNumber: string; neighborhood: string;
  city: string; state: string; position: string; height: string;
  weight: string; photo: File | null; existingPhotoUrl: string;
}

interface UserData {
  uid: string;
  email: string;
  displayName: string;
  role: 'super_admin' | 'admin' | 'user';
  status: 'pending' | 'approved' | 'rejected';
  invitationCodeUsed?: string;
  createdAt?: any;
  reviewedBy?: string;
  reviewedAt?: any;
}

interface InvitationData {
  id: string;
  code: string;
  inviteeName: string;
  inviteeEmail: string;
  status: 'available' | 'used' | 'cancelled';
  createdBy: string;
  usedBy?: string;
  usedAt?: any;
  createdAt?: any;
}

type AppView = 'login' | 'request-access' | 'pending-approval' | 'rejected' | 
               'galeria' | 'cadastro' | 'squad' | 'gestao';

// ============ COMPONENTE PRINCIPAL ============

export default function App() {
  // Auth
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [currentView, setCurrentView] = useState<AppView>('login');
  
  // Login/Signup forms
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginMethod, setLoginMethod] = useState<'email' | 'google'>('email');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoadingAction, setAuthLoadingAction] = useState(false);
  
  // Request Access form
  const [inviteCode, setInviteCode] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  
  // App state
  const [teams, setTeams] = useState<PlayerData[]>([]);
  const [invitations, setInvitations] = useState<InvitationData[]>([]);
  const [allUsers, setAllUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedSquadPlayers, setSelectedSquadPlayers] = useState<PlayerData[]>([]);
  const [squadSearchTerm, setSquadSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<'todos' | 'sub17' | 'sub20' | 'profissional'>('todos');
  
  // New invite form
  const [newInviteName, setNewInviteName] = useState('');
  const [newInviteEmail, setNewInviteEmail] = useState('');
  const [generatedInviteCode, setGeneratedInviteCode] = useState<string | null>(null);
  const [manageTab, setManageTab] = useState<'convites' | 'pendentes' | 'aprovados' | 'rejeitados'>('pendentes');
  
  const [form, setForm] = useState<FormData>({
    teamName: '', coach: '', player: '', nickname: '', phone: '', isWhatsapp: false,
    birthDate: '', cep: '', address: '', addressNumber: '', neighborhood: '',
    city: '', state: '', position: '', height: '', weight: '',
    photo: null, existingPhotoUrl: ''
  });

  const [filterCity, setFilterCity] = useState('');
  const [filterTeam, setFilterTeam] = useState('');
  const [filterPosition, setFilterPosition] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerData | null>(null);

  // ============ AUTH LISTENER ============
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setFirebaseUser(currentUser);
      setAuthError(null);
      
      if (currentUser) {
        // Buscar dados do usuário no Firestore
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userDocRef);
          
          // Se é super admin e não existe documento, criar
          if (!userSnap.exists() && currentUser.email === SUPER_ADMIN_EMAIL) {
            const newUserData: UserData = {
              uid: currentUser.uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || 'Super Admin',
              role: 'super_admin',
              status: 'approved',
              createdAt: serverTimestamp()
            };
            await setDoc(userDocRef, newUserData);
            setUserData(newUserData);
            setCurrentView('galeria');
          } else if (userSnap.exists()) {
            const data = userSnap.data() as UserData;
            setUserData({ ...data, uid: currentUser.uid });
            
            if (data.status === 'pending') {
              setCurrentView('pending-approval');
            } else if (data.status === 'rejected') {
              setCurrentView('rejected');
            } else {
              setCurrentView('galeria');
            }
          } else {
            // Usuário autenticado mas sem documento (caso legado ou problema)
            // Para segurança, tratar como pendente
            setCurrentView('pending-approval');
          }
        } catch (err) {
          console.error('Erro ao carregar dados do usuário:', err);
          setAuthError('Erro ao carregar seus dados. Tente novamente.');
        }
      } else {
        setUserData(null);
        setCurrentView('login');
      }
      
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // ============ FIRESTORE LISTENERS ============
  
  // Times verificados (todos os aprovados veem)
  useEffect(() => {
    if (!firebaseUser || !userData || userData.status !== 'approved') return;
    
    const qVerified = query(collection(db, 'teams'), where('isVerified', '==', true));
    const unsubscribeVerified = onSnapshot(qVerified, (snapshot) => {
      const verifiedTeams: PlayerData[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PlayerData));
      setTeams(prev => {
        const others = prev.filter(p => !p.isVerified);
        const merged = [...verifiedTeams, ...others];
        return merged.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'teams'));
    return () => { unsubscribeVerified(); };
  }, [firebaseUser, userData]);

  // Times pendentes (só admin/super admin ou dono)
  useEffect(() => {
    if (!firebaseUser || !userData || userData.status !== 'approved') return;
    
    const isAdminUser = userData.role === 'super_admin' || userData.role === 'admin';
    const qOwnedOrAdmin = isAdminUser 
      ? query(collection(db, 'teams')) 
      : query(collection(db, 'teams'), where('ownerId', '==', firebaseUser.uid));

    const unsubscribe = onSnapshot(qOwnedOrAdmin, (snapshot) => {
      const docsData: PlayerData[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PlayerData));
      setTeams(prev => {
        const others = prev.filter(p => p.ownerId !== firebaseUser.uid && !isAdminUser);
        const merged = [...others, ...docsData];
        return merged.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'teams'));
    return () => { unsubscribe(); };
  }, [firebaseUser, userData]);

  // Convites (só admin/super admin)
  useEffect(() => {
    if (!userData || (userData.role !== 'super_admin' && userData.role !== 'admin')) return;
    
    const q = query(collection(db, 'invitations'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: InvitationData[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as InvitationData));
      setInvitations(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });
    return () => { unsubscribe(); };
  }, [userData]);

  // Todos os usuários (só admin/super admin)
  useEffect(() => {
    if (!userData || (userData.role !== 'super_admin' && userData.role !== 'admin')) return;
    
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: UserData[] = snapshot.docs.map(d => ({ uid: d.id, ...d.data() } as UserData));
      setAllUsers(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });
    return () => { unsubscribe(); };
  }, [userData]);

  // ============ AUTH HANDLERS ============

  const handleGoogleLogin = async () => {
    setAuthLoadingAction(true);
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/unauthorized-domain') {
        setAuthError('Domínio não autorizado no Firebase.');
      } else {
        setAuthError('Erro ao fazer login com Google: ' + (error.message || 'Tente novamente.'));
      }
    } finally {
      setAuthLoadingAction(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoadingAction(true);
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      setLoginEmail('');
      setLoginPassword('');
    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setAuthError('E-mail ou senha incorretos.');
      } else if (error.code === 'auth/invalid-email') {
        setAuthError('E-mail inválido.');
      } else {
        setAuthError('Erro ao fazer login: ' + (error.message || 'Tente novamente.'));
      }
    } finally {
      setAuthLoadingAction(false);
    }
  };

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoadingAction(true);
    setAuthError(null);
    
    // Validações básicas
    if (signupPassword !== signupConfirm) {
      setAuthError('As senhas não coincidem.');
      setAuthLoadingAction(false);
      return;
    }
    if (signupPassword.length < 6) {
      setAuthError('A senha deve ter pelo menos 6 caracteres.');
      setAuthLoadingAction(false);
      return;
    }
    
    try {
      // 1. Validar código do convite
      const codeUpper = inviteCode.trim().toUpperCase();
      const q = query(collection(db, 'invitations'), where('code', '==', codeUpper));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        setAuthError('Código de convite inválido. Verifique e tente novamente.');
        setAuthLoadingAction(false);
        return;
      }
      
      const inviteDoc = snapshot.docs[0];
      const inviteData = inviteDoc.data() as InvitationData;
      
      if (inviteData.status !== 'available') {
        setAuthError('Este código de convite já foi utilizado ou cancelado.');
        setAuthLoadingAction(false);
        return;
      }
      
      // 2. Criar usuário no Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, signupEmail.trim(), signupPassword);
      await updateProfile(userCredential.user, { displayName: signupName.trim() });
      
      // 3. Criar documento no Firestore com status pending
      const newUserData: UserData = {
        uid: userCredential.user.uid,
        email: signupEmail.trim(),
        displayName: signupName.trim(),
        role: 'user',
        status: 'pending',
        invitationCodeUsed: codeUpper,
        createdAt: serverTimestamp()
      };
      await setDoc(doc(db, 'users', userCredential.user.uid), newUserData);
      
      // 4. Marcar convite como usado
      await updateDoc(doc(db, 'invitations', inviteDoc.id), {
        status: 'used',
        usedBy: userCredential.user.uid,
        usedAt: serverTimestamp()
      });
      
      // Limpar formulário
      setInviteCode('');
      setSignupName('');
      setSignupEmail('');
      setSignupPassword('');
      setSignupConfirm('');
      
      // onAuthStateChanged vai redirecionar pra tela de pending-approval
    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/email-already-in-use') {
        setAuthError('Este e-mail já está cadastrado. Tente fazer login.');
      } else if (error.code === 'auth/invalid-email') {
        setAuthError('E-mail inválido.');
      } else if (error.code === 'auth/weak-password') {
        setAuthError('Senha muito fraca. Use pelo menos 6 caracteres.');
      } else {
        setAuthError('Erro ao criar conta: ' + (error.message || 'Tente novamente.'));
      }
    } finally {
      setAuthLoadingAction(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setLoginEmail('');
      setLoginPassword('');
      setAuthError(null);
    } catch (e) {
      console.error('Erro ao sair', e);
    }
  };

  // ============ GESTÃO HANDLERS ============

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !userData) return;
    if (userData.role !== 'super_admin' && userData.role !== 'admin') return;
    
    setLoading(true);
    setErrorMsg(null);
    try {
      // Gerar código único (verificar se já existe)
      let code = generateInviteCode();
      let attempts = 0;
      while (attempts < 5) {
        const existing = await getDocs(query(collection(db, 'invitations'), where('code', '==', code)));
        if (existing.empty) break;
        code = generateInviteCode();
        attempts++;
      }
      
      const inviteData: InvitationData = {
        id: generateId(),
        code: code,
        inviteeName: newInviteName.trim(),
        inviteeEmail: newInviteEmail.trim().toLowerCase(),
        status: 'available',
        createdBy: firebaseUser.uid,
        createdAt: serverTimestamp()
      };
      
      await setDoc(doc(db, 'invitations', inviteData.id), inviteData);
      setGeneratedInviteCode(code);
      setNewInviteName('');
      setNewInviteEmail('');
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Erro ao gerar convite: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!confirm('Tem certeza que deseja cancelar este convite?')) return;
    try {
      await updateDoc(doc(db, 'invitations', inviteId), {
        status: 'cancelled',
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      alert('Erro ao cancelar convite: ' + err.message);
    }
  };

  const handleApproveUser = async (uid: string) => {
    if (!firebaseUser) return;
    try {
      await updateDoc(doc(db, 'users', uid), {
        status: 'approved',
        reviewedBy: firebaseUser.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      alert('Erro ao aprovar: ' + err.message);
    }
  };

  const handleRejectUser = async (uid: string) => {
    if (!firebaseUser) return;
    if (!confirm('Tem certeza que deseja rejeitar este usuário?')) return;
    try {
      await updateDoc(doc(db, 'users', uid), {
        status: 'rejected',
        reviewedBy: firebaseUser.uid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      alert('Erro ao rejeitar: ' + err.message);
    }
  };

  const handlePromoteToAdmin = async (uid: string) => {
    if (userData?.role !== 'super_admin') {
      alert('Apenas o super admin pode promover usuários.');
      return;
    }
    if (!confirm('Promover este usuário a Admin?')) return;
    try {
      await updateDoc(doc(db, 'users', uid), {
        role: 'admin',
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      alert('Erro ao promover: ' + err.message);
    }
  };

  const handleDemoteToUser = async (uid: string) => {
    if (userData?.role !== 'super_admin') return;
    if (!confirm('Rebaixar este admin para usuário comum?')) return;
    try {
      await updateDoc(doc(db, 'users', uid), {
        role: 'user',
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      alert('Erro ao rebaixar: ' + err.message);
    }
  };

  const handleDeleteUser = async (uid: string) => {
    if (userData?.role !== 'super_admin') {
      alert('Apenas o super admin pode deletar contas.');
      return;
    }
    if (!confirm('ATENÇÃO: Deletar esta conta é permanente. Continuar?')) return;
    try {
      await deleteDoc(doc(db, 'users', uid));
      alert('Conta deletada do sistema. (O acesso do Firebase Auth precisa ser removido manualmente no console do Firebase se necessário.)');
    } catch (err: any) {
      alert('Erro ao deletar: ' + err.message);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    alert('Código copiado: ' + code);
  };

  // ============ ATLETAS HANDLERS ============

  const handleApproveAthlete = async (teamId: string) => {
    try {
      await updateDoc(doc(db, 'teams', teamId), {
        isVerified: true,
        updatedAt: serverTimestamp()
      });
    } catch (err: any) {
      alert('Erro ao aprovar: ' + err.message);
    }
  };

  const handleEdit = (team: PlayerData) => {
    if (userData?.role !== 'super_admin' && userData?.role !== 'admin') return;
    setForm({
      teamName: team.teamName || '', coach: team.coach || '',
      player: team.playerName || '', nickname: team.nickname || '',
      phone: team.phone || '', isWhatsapp: team.isWhatsapp || false,
      birthDate: team.birthDate || '', cep: team.cep || '',
      address: team.address || '', addressNumber: team.addressNumber || '',
      neighborhood: team.neighborhood || '', city: team.city || '',
      state: team.state || '', position: team.position || '',
      height: team.height || '', weight: team.weight || '',
      photo: null, existingPhotoUrl: team.playerPhoto || ''
    });
    setEditingId(team.id);
    setCurrentView('cadastro');
  };

  const resetForm = () => {
    setForm({
      teamName: '', coach: '', player: '', nickname: '', phone: '', isWhatsapp: false,
      birthDate: '', cep: '', address: '', addressNumber: '', neighborhood: '',
      city: '', state: '', position: '', height: '', weight: '',
      photo: null, existingPhotoUrl: ''
    });
    setEditingId(null);
  };

  // ============ INPUT HANDLERS ============

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 11) val = val.slice(0, 11);
    if (val.length > 2) val = `(${val.slice(0, 2)}) ${val.slice(2)}`;
    if (val.length > 9) val = `${val.slice(0, 10)}-${val.slice(10)}`;
    setForm(prev => ({ ...prev, phone: val }));
  };

  const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^0-9,.]/g, '').replace('.', ',');
    if (val.length > 4) val = val.slice(0, 4);
    setForm(prev => ({ ...prev, height: val }));
  };

  const handleWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 3) val = val.slice(0, 3);
    setForm(prev => ({ ...prev, weight: val }));
  };

  const handleBirthDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 8) val = val.slice(0, 8);
    if (val.length >= 5) val = `${val.slice(0, 2)}/${val.slice(2, 4)}/${val.slice(4)}`;
    else if (val.length >= 3) val = `${val.slice(0, 2)}/${val.slice(2)}`;
    setForm(prev => ({ ...prev, birthDate: val }));
  };

  const handleCepChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 8) val = val.slice(0, 8);
    const formattedVal = val.length > 5 ? `${val.slice(0, 5)}-${val.slice(5)}` : val;
    setForm(prev => ({ ...prev, cep: formattedVal }));

    if (val.length === 8) {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${val}/json/`);
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

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setForm({ ...form, photo: e.target.files[0] });
    }
  };

  // ============ SUBMIT ATLETA ============

  const handleSubmitAthlete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !userData) return;
    if (userData.role !== 'super_admin' && userData.role !== 'admin') {
      alert('Você não tem permissão para cadastrar atletas.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      let photoUrl = form.existingPhotoUrl;
      if (form.photo) {
        photoUrl = await compressImage(form.photo);
      }

      if (editingId) {
        await updateDoc(doc(db, 'teams', editingId), {
          teamName: form.teamName, coach: form.coach, playerName: form.player,
          nickname: form.nickname, phone: form.phone, isWhatsapp: form.isWhatsapp,
          birthDate: form.birthDate, cep: form.cep, address: form.address,
          addressNumber: form.addressNumber, neighborhood: form.neighborhood,
          city: form.city, state: form.state, position: form.position,
          height: form.height, weight: form.weight, playerPhoto: photoUrl,
          updatedAt: serverTimestamp()
        });
        alert('Ficha Atualizada!');
      } else {
        const teamId = generateId();
        await setDoc(doc(db, 'teams', teamId), {
          ownerId: firebaseUser.uid,
          teamName: form.teamName, coach: form.coach, playerName: form.player,
          nickname: form.nickname, phone: form.phone, isWhatsapp: form.isWhatsapp,
          birthDate: form.birthDate, cep: form.cep, address: form.address,
          addressNumber: form.addressNumber, neighborhood: form.neighborhood,
          city: form.city, state: form.state, position: form.position,
          height: form.height, weight: form.weight, playerPhoto: photoUrl,
          isVerified: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        alert('Ficha Registrada com Sucesso! Aguardando aprovação.');
      }

      resetForm();
      setCurrentView('galeria');
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  // ============ FILTROS ============

  const filteredTeams = useMemo(() => {
    return teams.filter(t => {
      const matchCity = filterCity ? (t.city?.toLowerCase().includes(filterCity.toLowerCase()) ?? false) : true;
      const matchTeam = filterTeam ? (t.teamName?.toLowerCase().includes(filterTeam.toLowerCase()) ?? false) : true;
      const matchPosition = filterPosition ? (t.position?.toLowerCase() === filterPosition.toLowerCase()) : true;
      
      let matchCategory = true;
      if (activeCategory !== 'todos') {
        const age = calculateAge(t.birthDate);
        const cat = getCategoryFromAge(age);
        matchCategory = cat === activeCategory;
      }
      
      return matchCity && matchTeam && matchPosition && matchCategory;
    });
  }, [teams, filterCity, filterTeam, filterPosition, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts = { todos: 0, sub17: 0, sub20: 0, profissional: 0 };
    teams.forEach(t => {
      counts.todos++;
      const age = calculateAge(t.birthDate);
      const cat = getCategoryFromAge(age);
      if (cat === 'sub17') counts.sub17++;
      else if (cat === 'sub20') counts.sub20++;
      else if (cat === 'profissional') counts.profissional++;
    });
    return counts;
  }, [teams]);

  // Contadores para painel de gestão
  const manageCounts = useMemo(() => {
    return {
      convites: invitations.filter(i => i.status === 'available').length,
      pendentes: allUsers.filter(u => u.status === 'pending').length,
      aprovados: allUsers.filter(u => u.status === 'approved').length,
      rejeitados: allUsers.filter(u => u.status === 'rejected').length,
    };
  }, [invitations, allUsers]);

  const isSuperAdmin = userData?.role === 'super_admin';
  const isAdminOrSuper = userData?.role === 'super_admin' || userData?.role === 'admin';
  const canCreateInvite = isAdminOrSuper;
  const canManageAthletes = isAdminOrSuper;
  const canDeleteAthlete = isSuperAdmin;

  // ============ LOADING STATE ============
  if (authLoading) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-emerald-600 border-t-transparent mb-4"></div>
          <p className="text-stone-600 font-bold">Carregando...</p>
        </div>
      </div>
    );
  }

  // ============ RENDER ============

  return (
    <div className="min-h-screen bg-stone-100 font-sans text-stone-900 pb-12">
      {/* ============ TELA DE LOGIN ============ */}
      {currentView === 'login' && (
        <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img src="https://images.unsplash.com/photo-1587329310686-91414b8e3cb7?w=1600&q=80" className="w-full h-full object-cover" alt="" />
            <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/80 to-stone-900/50"></div>
          </div>
          
          <div className="relative z-10 w-full max-w-md">
            <div className="bg-white rounded-[32px] shadow-2xl p-8 border border-stone-200">
              {/* Header do Login */}
              <div className="text-center mb-8">
                <div className="inline-flex flex-col items-center mb-4">
                  <div className="flex items-end justify-center mb-1" style={{ width: '100px', height: '28px' }}>
                    <svg viewBox="0 0 180 50" className="w-full h-full overflow-visible">
                      <path id="curve-login" d="M 0 50 Q 90 -10 180 50" fill="transparent" />
                      <text fill="#22c55e" fontSize="24" fontWeight="bold" letterSpacing="2">
                        <textPath href="#curve-login" startOffset="50%" textAnchor="middle">★★★★★★★</textPath>
                      </text>
                    </svg>
                  </div>
                  <img src="https://logodownload.org/wp-content/uploads/2017/11/cbf-logo-selecao-logo-brasil-2.png" alt="CBF" className="h-16 drop-shadow-md" />
                </div>
                <h1 className="text-2xl font-black text-emerald-900 uppercase tracking-tight">Beach Soccer</h1>
                <p className="text-stone-500 text-sm mt-1 font-medium">Faça login para continuar</p>
              </div>

              {/* Tabs de método de login */}
              <div className="flex bg-stone-100 p-1 rounded-xl mb-6">
                <button onClick={() => { setLoginMethod('email'); setAuthError(null); }}
                  className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-all ${loginMethod === 'email' ? 'bg-white text-emerald-900 shadow-sm' : 'text-stone-500'}`}>
                  <Mail size={14} className="inline mr-1" /> E-mail
                </button>
                <button onClick={() => { setLoginMethod('google'); setAuthError(null); }}
                  className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-all ${loginMethod === 'google' ? 'bg-white text-emerald-900 shadow-sm' : 'text-stone-500'}`}>
                  Google
                </button>
              </div>

              {/* Login por Email */}
              {loginMethod === 'email' && (
                <form onSubmit={handleEmailLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5 ml-1">E-mail</label>
                    <input type="email" required value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-medium"
                      placeholder="seu@email.com" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5 ml-1">Senha</label>
                    <div className="relative">
                      <input type={showPassword ? 'text' : 'password'} required value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 p-3 pr-11 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-medium"
                        placeholder="••••••••" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                  <button type="submit" disabled={authLoadingAction}
                    className="w-full bg-orange-500 text-white p-3.5 rounded-xl font-black text-base uppercase tracking-wide hover:bg-orange-600 transition-all disabled:opacity-50 shadow-md flex items-center justify-center gap-2">
                    {authLoadingAction ? 'Entrando...' : (<><Lock size={18} /> Entrar</>)}
                  </button>
                </form>
              )}

              {/* Login por Google */}
              {loginMethod === 'google' && (
                <div className="space-y-4">
                  <button onClick={handleGoogleLogin} disabled={authLoadingAction}
                    className="w-full bg-white border-2 border-stone-200 text-stone-800 p-3.5 rounded-xl font-bold text-base hover:bg-stone-50 transition-all disabled:opacity-50 flex items-center justify-center gap-3">
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    {authLoadingAction ? 'Entrando...' : 'Continuar com Google'}
                  </button>
                  <p className="text-xs text-stone-500 text-center font-medium">
                    Recomendado para super admin e admins
                  </p>
                </div>
              )}

              {authError && (
                <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-xl border border-red-200 font-medium">
                  {authError}
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-stone-100 text-center">
                <button onClick={() => { setCurrentView('request-access'); setAuthError(null); }}
                  className="text-sm text-orange-600 font-bold hover:text-orange-700 transition-colors flex items-center justify-center gap-1 mx-auto">
                  <Ticket size={14} /> Não tem acesso? Solicitar com convite
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ TELA DE SOLICITAR ACESSO ============ */}
      {currentView === 'request-access' && (
        <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img src="https://images.unsplash.com/photo-1587329310686-91414b8e3cb7?w=1600&q=80" className="w-full h-full object-cover" alt="" />
            <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/80 to-stone-900/50"></div>
          </div>
          
          <div className="relative z-10 w-full max-w-md">
            <div className="bg-white rounded-[32px] shadow-2xl p-8 border border-stone-200">
              <button onClick={() => { setCurrentView('login'); setAuthError(null); }}
                className="flex items-center gap-2 text-stone-500 hover:text-stone-800 font-bold text-sm mb-6 transition-colors">
                <ArrowLeft size={16} /> Voltar ao login
              </button>
              
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-orange-100 rounded-2xl mb-4">
                  <Ticket className="text-orange-600" size={32} />
                </div>
                <h1 className="text-2xl font-black text-emerald-900 uppercase tracking-tight">Solicitar Acesso</h1>
                <p className="text-stone-500 text-sm mt-1 font-medium">Use o código de convite recebido</p>
              </div>

              <form onSubmit={handleRequestAccess} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5 ml-1">Código do Convite</label>
                  <div className="relative">
                    <Key size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                    <input type="text" required value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                      className="w-full bg-stone-50 border border-stone-200 p-3 pl-11 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-mono font-bold tracking-widest uppercase"
                      placeholder="INV-XXXXXXXX" maxLength={12} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5 ml-1">Nome Completo</label>
                  <input type="text" required value={signupName}
                    onChange={(e) => setSignupName(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-medium"
                    placeholder="Seu nome completo" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5 ml-1">E-mail</label>
                  <input type="email" required value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-medium"
                    placeholder="seu@email.com" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5 ml-1">Senha (mín. 6 caracteres)</label>
                  <input type="password" required value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-medium"
                    placeholder="••••••••" minLength={6} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5 ml-1">Confirmar Senha</label>
                  <input type="password" required value={signupConfirm}
                    onChange={(e) => setSignupConfirm(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-medium"
                    placeholder="••••••••" minLength={6} />
                </div>
                
                {authError && (
                  <div className="p-3 bg-red-50 text-red-700 text-sm rounded-xl border border-red-200 font-medium">
                    {authError}
                  </div>
                )}
                
                <button type="submit" disabled={authLoadingAction}
                  className="w-full bg-orange-500 text-white p-3.5 rounded-xl font-black text-base uppercase tracking-wide hover:bg-orange-600 transition-all disabled:opacity-50 shadow-md flex items-center justify-center gap-2">
                  {authLoadingAction ? 'Criando conta...' : (<><UserPlus size={18} /> Criar Conta</>)}
                </button>
                
                <p className="text-xs text-stone-500 text-center font-medium mt-2">
                  Ao criar, sua conta ficará <b>aguardando aprovação</b> do administrador.
                </p>
              </form>

              <div className="mt-6 pt-6 border-t border-stone-100 text-center">
                <button onClick={() => { setCurrentView('login'); setAuthError(null); }}
                  className="text-sm text-orange-600 font-bold hover:text-orange-700 transition-colors">
                  Já tem conta? Fazer login
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ TELA: AGUARDANDO APROVAÇÃO ============ */}
      {currentView === 'pending-approval' && (
        <div className="min-h-screen flex items-center justify-center p-4 bg-stone-100">
          <div className="bg-white rounded-[32px] shadow-xl p-10 max-w-md text-center border border-stone-200">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-amber-100 rounded-full mb-6">
              <Clock className="text-amber-600 animate-pulse" size={40} />
            </div>
            <h2 className="text-2xl font-black text-emerald-900 mb-3">Aguardando Aprovação</h2>
            <p className="text-stone-600 mb-2">
              Olá, <b>{userData?.displayName}</b>!
            </p>
            <p className="text-stone-500 mb-6">
              Sua conta foi criada com sucesso e está aguardando a aprovação do administrador. Você receberá acesso assim que for aprovada.
            </p>
            <div className="bg-stone-50 p-4 rounded-xl text-sm text-stone-600 mb-6">
              <p className="font-bold text-stone-800 mb-1">E-mail cadastrado:</p>
              <p className="font-mono">{userData?.email}</p>
            </div>
            <button onClick={handleLogout}
              className="bg-stone-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-stone-800 transition-colors flex items-center justify-center gap-2 mx-auto">
              <LogOut size={16} /> Sair
            </button>
          </div>
        </div>
      )}

      {/* ============ TELA: CONTA REJEITADA ============ */}
      {currentView === 'rejected' && (
        <div className="min-h-screen flex items-center justify-center p-4 bg-stone-100">
          <div className="bg-white rounded-[32px] shadow-xl p-10 max-w-md text-center border border-stone-200">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-red-100 rounded-full mb-6">
              <UserX className="text-red-600" size={40} />
            </div>
            <h2 className="text-2xl font-black text-emerald-900 mb-3">Acesso Negado</h2>
            <p className="text-stone-500 mb-6">
              Sua solicitação de acesso foi analisada e, no momento, não foi aprovada pelo administrador.
            </p>
            <p className="text-sm text-stone-400 mb-6">
              Se acredita que houve engano, entre em contato com o administrador.
            </p>
            <button onClick={handleLogout}
              className="bg-stone-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-stone-800 transition-colors flex items-center justify-center gap-2 mx-auto">
              <LogOut size={16} /> Sair
            </button>
          </div>
        </div>
      )}

      {/* ============ APP AUTENTICADO ============ */}
      {userData?.status === 'approved' && (
        <>
          {/* Header */}
          <nav className="bg-emerald-900 p-4 text-white shadow-md relative z-10 overflow-hidden border-b-4 border-yellow-500 print:hidden">
            <div className="absolute inset-0 z-0 bg-emerald-900">
              <img src="https://images.unsplash.com/photo-1544605481-64ffdc61922c?w=1600&q=80" className="w-full h-full object-cover opacity-20 mix-blend-overlay" alt="" />
            </div>
            <div className="max-w-6xl mx-auto flex justify-between items-center relative z-10">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <div className="relative flex flex-col items-center">
                    <div className="flex items-end justify-center mb-0.5" style={{ width: '56px', height: '16px' }}>
                      <svg viewBox="0 0 180 50" className="w-full h-full overflow-visible">
                        <path id="curve" d="M 0 50 Q 90 -10 180 50" fill="transparent" />
                        <text fill="#22c55e" fontSize="24" fontWeight="bold" letterSpacing="2">
                          <textPath href="#curve" startOffset="50%" textAnchor="middle">★★★★★★★</textPath>
                        </text>
                      </svg>
                    </div>
                    <img src="https://logodownload.org/wp-content/uploads/2017/11/cbf-logo-selecao-logo-brasil-2.png" alt="CBF" className="h-10 drop-shadow-md relative z-10" />
                  </div>
                  <div className="flex flex-col">
                    <h1 className="text-2xl font-black flex items-center gap-2 uppercase tracking-tight leading-none">
                      Beach Soccer
                    </h1>
                    <div className="flex justify-between w-full mt-0.5" style={{ fontSize: '7.5px' }}>
                      <p className="text-yellow-400 font-bold uppercase w-full flex justify-between leading-none" style={{ letterSpacing: '0.15em' }}>
                        <span>C</span><span>o</span><span>m</span><span>i</span><span>s</span><span>s</span><span>ã</span><span>o</span>
                        <span>&nbsp;</span>
                        <span>T</span><span>é</span><span>c</span><span>n</span><span>i</span><span>c</span><span>a</span>
                      </p>
                    </div>
                  </div>
                </div>
                <div className="hidden md:flex bg-emerald-900/60 p-1 rounded-xl backdrop-blur-sm border border-white/10">
                  <button onClick={() => setCurrentView('galeria')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${currentView === 'galeria' ? 'bg-orange-500 shadow-sm' : 'hover:bg-emerald-700/50 text-emerald-100'}`}>
                    <Users size={18} /> Jogadores
                  </button>
                  {canManageAthletes && (
                    <button onClick={() => setCurrentView('cadastro')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${currentView === 'cadastro' ? 'bg-orange-500 shadow-sm' : 'hover:bg-emerald-700/50 text-emerald-100'}`}>
                      <PlusCircle size={18} /> Nova Ficha
                    </button>
                  )}
                  <button onClick={() => setCurrentView('squad')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${currentView === 'squad' ? 'bg-orange-500 shadow-sm' : 'hover:bg-emerald-700/50 text-emerald-100'}`}>
                    <Trophy size={18} /> Montar Time
                  </button>
                  {isAdminOrSuper && (
                    <button onClick={() => setCurrentView('gestao')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${currentView === 'gestao' ? 'bg-orange-500 shadow-sm' : 'hover:bg-emerald-700/50 text-emerald-100'}`}>
                      <ShieldCheck size={18} /> Gestão
                      {manageCounts.pendentes > 0 && (
                        <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                          {manageCounts.pendentes}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-bold text-white drop-shadow-sm flex items-center gap-1 justify-end">
                    {firebaseUser?.displayName}
                    {isSuperAdmin && <span className="bg-yellow-400 text-stone-900 text-[9px] px-1.5 py-0.5 rounded font-black">SUPER</span>}
                    {!isSuperAdmin && isAdminOrSuper && <span className="bg-orange-400 text-stone-900 text-[9px] px-1.5 py-0.5 rounded font-black">ADMIN</span>}
                  </p>
                  <p className="text-xs text-emerald-100 mt-0.5">{firebaseUser?.email}</p>
                </div>
                {firebaseUser?.photoURL && (
                  <img src={firebaseUser.photoURL} alt="Avatar" className="w-10 h-10 rounded-full border-2 border-orange-400 shadow-md object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                )}
                <button onClick={handleLogout}
                  className="bg-emerald-950/80 hover:bg-stone-900 px-3 py-2 rounded-lg flex items-center gap-2 transition-all border border-emerald-800 shadow-sm ml-2">
                  <LogOut size={16} /> <span className="hidden sm:inline">Sair</span>
                </button>
              </div>
            </div>
          </nav>

          {/* Navegação Mobile */}
          <div className="md:hidden flex bg-emerald-900 p-2 shadow-inner gap-2 overflow-x-auto print:hidden">
            <button onClick={() => setCurrentView('galeria')}
              className={`flex-none px-3 py-2 rounded-lg font-bold transition-colors flex items-center justify-center gap-1 text-xs ${currentView === 'galeria' ? 'bg-orange-500 text-white shadow-sm' : 'bg-emerald-800 text-emerald-200 hover:bg-emerald-700'}`}>
              <Users size={14} /> Jogadores
            </button>
            {canManageAthletes && (
              <button onClick={() => setCurrentView('cadastro')}
                className={`flex-none px-3 py-2 rounded-lg font-bold transition-colors flex items-center justify-center gap-1 text-xs ${currentView === 'cadastro' ? 'bg-orange-500 text-white shadow-sm' : 'bg-emerald-800 text-emerald-200 hover:bg-emerald-700'}`}>
                <PlusCircle size={14} /> Nova Ficha
              </button>
            )}
            <button onClick={() => setCurrentView('squad')}
              className={`flex-none px-3 py-2 rounded-lg font-bold transition-colors flex items-center justify-center gap-1 text-xs ${currentView === 'squad' ? 'bg-orange-500 text-white shadow-sm' : 'bg-emerald-800 text-emerald-200 hover:bg-emerald-700'}`}>
              <Trophy size={14} /> Montar Time
            </button>
            {isAdminOrSuper && (
              <button onClick={() => setCurrentView('gestao')}
                className={`flex-none px-3 py-2 rounded-lg font-bold transition-colors flex items-center justify-center gap-1 text-xs ${currentView === 'gestao' ? 'bg-orange-500 text-white shadow-sm' : 'bg-emerald-800 text-emerald-200 hover:bg-emerald-700'}`}>
                <ShieldCheck size={14} /> Gestão
                {manageCounts.pendentes > 0 && (
                  <span className="bg-red-500 text-white text-[9px] font-black px-1 py-0.5 rounded-full">{manageCounts.pendentes}</span>
                )}
              </button>
            )}
          </div>

          <main className="max-w-6xl mx-auto p-4 md:p-6 mt-4">
            {/* ============ CADASTRO ============ */}
            {currentView === 'cadastro' && canManageAthletes && (
              <div className="max-w-3xl mx-auto bg-white p-6 md:p-10 rounded-[32px] shadow-sm border border-emerald-100">
                <div className="flex items-center gap-4 mb-10">
                  <div className="bg-orange-100 p-4 rounded-2xl text-orange-600">
                    <PlusCircle size={32} />
                  </div>
                  <div>
                    <h2 className="text-3xl font-black text-emerald-900 leading-tight tracking-tight">
                      {editingId ? 'Editar Ficha' : 'Ficha de Inscrição'}
                    </h2>
                    <p className="text-stone-500 font-medium">Preencha os dados do atleta para avaliação</p>
                  </div>
                </div>

                <form onSubmit={handleSubmitAthlete} className="flex flex-col gap-8">
                  <div>
                    <h3 className="font-bold text-emerald-800 mb-4 flex items-center gap-2 uppercase tracking-wide text-sm border-b border-emerald-100 pb-2">Informações do Clube</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Clube / Time</label>
                        <input className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-medium"
                          placeholder="Ex: Caiçara FC" value={form.teamName}
                          onChange={(e) => setForm({ ...form, teamName: e.target.value })} required />
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Nome do Treinador</label>
                        <input className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-medium"
                          placeholder="Ex: Prof. João" value={form.coach}
                          onChange={(e) => setForm({ ...form, coach: e.target.value })} required />
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="font-bold text-orange-600 mb-4 flex items-center gap-2 uppercase tracking-wide text-sm border-b border-orange-100 pb-2">Dados do Atleta</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                      <div className="md:col-span-2">
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Nome Completo</label>
                        <input className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                          placeholder="Ex: Carlos Oliveira Silva" value={form.player}
                          onChange={(e) => setForm({ ...form, player: e.target.value })} required />
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Apelido</label>
                        <input className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                          placeholder="Ex: Carlinhos" value={form.nickname}
                          onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Telefone</label>
                        <input className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                          placeholder="(11) 99999-9999" value={form.phone}
                          onChange={handlePhoneChange} maxLength={15} />
                        <div className="mt-2 flex items-center gap-2 ml-1">
                          <input type="checkbox" id="isWhatsapp" checked={form.isWhatsapp}
                            onChange={e => setForm({...form, isWhatsapp: e.target.checked})}
                            className="w-4 h-4 text-orange-500 rounded focus:ring-orange-500" />
                          <label htmlFor="isWhatsapp" className="text-xs font-bold text-stone-500 cursor-pointer">É WhatsApp?</label>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Data de Nascimento</label>
                        <input type="text"
                          className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium text-stone-700"
                          placeholder="DD/MM/AAAA" value={form.birthDate}
                          onChange={handleBirthDateChange} />
                      </div>
                      <div className="md:col-span-2 mt-4 pt-4 border-t border-stone-100">
                        <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">Endereço Residencial</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                          <div>
                            <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">CEP</label>
                            <input type="text" className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                              placeholder="00000-000" value={form.cep} onChange={handleCepChange} />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Endereço (Rua/Av)</label>
                            <input className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                              placeholder="Ex: Rua das Rosas" value={form.address}
                              onChange={(e) => setForm({ ...form, address: e.target.value })} />
                          </div>
                          <div>
                            <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Número</label>
                            <input className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                              placeholder="Ex: 123" value={form.addressNumber}
                              onChange={(e) => setForm({ ...form, addressNumber: e.target.value })} />
                          </div>
                          <div>
                            <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Bairro</label>
                            <input className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                              placeholder="Ex: Centro" value={form.neighborhood}
                              onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
                          </div>
                          <div>
                            <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Cidade</label>
                            <input className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                              placeholder="Ex: Rio de Janeiro" value={form.city}
                              onChange={(e) => setForm({ ...form, city: e.target.value })} />
                          </div>
                          <div>
                            <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Estado (UF)</label>
                            <input className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium uppercase"
                              placeholder="Ex: RJ" maxLength={2} value={form.state}
                              onChange={(e) => setForm({ ...form, state: e.target.value })} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5 mt-2">
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Posição</label>
                        <select className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium text-stone-700"
                          value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
                          <option value="">Selecione...</option>
                          <option value="Goleiro">Goleiro</option>
                          <option value="Fixo">Fixo</option>
                          <option value="Ala">Ala</option>
                          <option value="Pivô">Pivô</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Altura (m)</label>
                        <input className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                          placeholder="Ex: 1,83" value={form.height} onChange={handleHeightChange} />
                      </div>
                      <div>
                        <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Peso (kg)</label>
                        <input className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-medium"
                          placeholder="Ex: 78" value={form.weight} onChange={handleWeightChange} />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs uppercase font-bold text-stone-500 mb-1.5 ml-1">Foto de Rosto (Ficha)</label>
                      <label className="flex flex-col items-center justify-center gap-3 bg-stone-50 border-2 border-dashed border-stone-300 p-8 rounded-2xl cursor-pointer hover:bg-orange-50 hover:border-orange-300 transition-colors text-stone-500 group">
                        <Camera size={36} className="text-stone-400 group-hover:text-orange-500 transition-colors" />
                        <span className="text-sm font-bold text-center px-4">
                          {form.photo ? form.photo.name : (form.existingPhotoUrl ? 'Substituir foto atual?' : 'Clique para enviar foto. Prefira imagens claras do rosto.')}
                        </span>
                        <input type="file" className="hidden" onChange={handleFile} accept="image/*" />
                      </label>
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="p-4 bg-red-50 text-red-700 text-sm rounded-xl border border-red-200 font-medium">
                      <b>Erro:</b> {errorMsg}
                    </div>
                  )}

                  <div className="border-t border-stone-100 pt-6 mt-4">
                    <button className="w-full bg-emerald-800 text-white p-4 rounded-xl font-black text-lg uppercase tracking-wide hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md flex items-center justify-center gap-2"
                      disabled={loading}>
                      {loading ? 'Processando Ficha...' : (editingId ? 'Atualizar Ficha' : 'Enviar Inscrição')}
                    </button>
                    {editingId && (
                      <button type="button" onClick={() => { resetForm(); setCurrentView('galeria'); }}
                        className="mt-3 w-full text-stone-500 p-2 font-bold uppercase text-sm hover:text-stone-800 transition-colors"
                        disabled={loading}>
                        Cancelar Edição
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )}

            {/* ============ GALERIA ============ */}
            {currentView === 'galeria' && (
              <div className="print:block">
                <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4 print:hidden">
                  <div>
                    <h2 className="text-3xl lg:text-4xl font-black text-emerald-900 leading-tight uppercase tracking-tight">Galeria de Atletas</h2>
                    <p className="text-stone-500 font-medium mt-1">Conheça as estrelas dos clubes do torneio</p>
                  </div>
                  {isAdminOrSuper && (
                    <div className="bg-amber-100 text-amber-800 px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 text-sm max-w-fit shadow-sm">
                      <ShieldCheck size={18} /> {isSuperAdmin ? 'Super Admin' : 'Admin'}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 mb-6 print:hidden">
                  <button onClick={() => setActiveCategory('todos')}
                    className={`px-5 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                      activeCategory === 'todos' 
                        ? 'bg-emerald-900 text-white shadow-md scale-105' 
                        : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
                    }`}>
                    <Users size={16} /> Todos <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-black ${activeCategory === 'todos' ? 'bg-orange-500 text-white' : 'bg-stone-100 text-stone-500'}`}>{categoryCounts.todos}</span>
                  </button>
                  <button onClick={() => setActiveCategory('sub17')}
                    className={`px-5 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                      activeCategory === 'sub17' 
                        ? 'bg-blue-600 text-white shadow-md scale-105' 
                        : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
                    }`}>
                    ⚽ Sub-17 <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-black ${activeCategory === 'sub17' ? 'bg-blue-500 text-white' : 'bg-stone-100 text-stone-500'}`}>{categoryCounts.sub17}</span>
                  </button>
                  <button onClick={() => setActiveCategory('sub20')}
                    className={`px-5 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                      activeCategory === 'sub20' 
                        ? 'bg-purple-600 text-white shadow-md scale-105' 
                        : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
                    }`}>
                    ⚽ Sub-20 <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-black ${activeCategory === 'sub20' ? 'bg-purple-500 text-white' : 'bg-stone-100 text-stone-500'}`}>{categoryCounts.sub20}</span>
                  </button>
                  <button onClick={() => setActiveCategory('profissional')}
                    className={`px-5 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                      activeCategory === 'profissional' 
                        ? 'bg-orange-600 text-white shadow-md scale-105' 
                        : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-50'
                    }`}>
                    🏆 Profissional <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-black ${activeCategory === 'profissional' ? 'bg-orange-500 text-white' : 'bg-stone-100 text-stone-500'}`}>{categoryCounts.profissional}</span>
                  </button>
                </div>

                <div className="bg-white p-5 rounded-[24px] flex flex-col md:flex-row gap-4 mb-8 shadow-sm border border-stone-200 justify-between items-center">
                  <div className="flex flex-wrap lg:flex-nowrap gap-4 w-full">
                    <div className="flex-1 min-w-[200px]">
                      <label className="text-xs font-bold text-stone-500 uppercase ml-1">Clube</label>
                      <div className="flex items-center gap-2 bg-stone-50 p-3 rounded-xl border border-stone-200 focus-within:border-emerald-500 focus-within:bg-white transition-all mt-1">
                        <Search size={18} className="text-stone-400" />
                        <input className="bg-transparent outline-none w-full text-sm font-medium"
                          placeholder="Buscar por clube..." value={filterTeam}
                          onChange={e => setFilterTeam(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <label className="text-xs font-bold text-stone-500 uppercase ml-1">Cidade</label>
                      <div className="flex items-center gap-2 bg-stone-50 p-3 rounded-xl border border-stone-200 focus-within:border-emerald-500 focus-within:bg-white transition-all mt-1">
                        <MapPin size={18} className="text-stone-400" />
                        <input className="bg-transparent outline-none w-full text-sm font-medium"
                          placeholder="Filtrar local..." value={filterCity}
                          onChange={e => setFilterCity(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-[150px]">
                      <label className="text-xs font-bold text-stone-500 uppercase ml-1">Posição</label>
                      <select className="w-full bg-stone-50 border border-stone-200 p-3 text-sm rounded-xl focus:border-emerald-500 focus:bg-white outline-none transition-all font-medium text-stone-700 mt-1"
                        value={filterPosition} onChange={(e) => setFilterPosition(e.target.value)}>
                        <option value="">Todas</option>
                        <option value="Goleiro">Goleiro</option>
                        <option value="Fixo">Fixo</option>
                        <option value="Ala">Ala</option>
                        <option value="Pivô">Pivô</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 bg-stone-100 p-1.5 rounded-xl border border-stone-200 self-end md:self-auto w-full md:w-auto justify-center">
                    <button onClick={() => window.print()}
                      className="p-2.5 rounded-lg transition-all flex items-center justify-center text-stone-400 hover:text-stone-600 print:hidden hidden md:block border-r border-stone-200 mr-1 pr-3"
                      title="Imprimir">
                      <Printer size={20} />
                    </button>
                    <button onClick={() => setViewMode('cards')}
                      className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${viewMode === 'cards' ? 'bg-white text-orange-500 shadow-sm' : 'text-stone-400 hover:text-stone-600'}`}
                      title="Ver em Cards">
                      <LayoutGrid size={20} />
                    </button>
                    <button onClick={() => setViewMode('table')}
                      className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${viewMode === 'table' ? 'bg-white text-orange-500 shadow-sm' : 'text-stone-400 hover:text-stone-600'}`}
                      title="Ver em Tabela">
                      <List size={20} />
                    </button>
                  </div>
                </div>

                {filteredTeams.length === 0 ? (
                  <div className="bg-white text-center p-16 rounded-[32px] border border-stone-200 shadow-sm">
                    <Users size={64} className="mx-auto text-stone-200 mb-4" />
                    <p className="text-stone-500 font-bold text-xl">Nenhum atleta encontrado.</p>
                    <p className="text-stone-400 mt-2">Ajuste os filtros ou a aba selecionada.</p>
                  </div>
                ) : viewMode === 'cards' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredTeams.map((t) => (
                      <div key={t.id} onClick={() => setSelectedPlayer(t)}
                        className="bg-white rounded-[24px] overflow-hidden shadow-sm hover:shadow-xl hover:ring-2 hover:ring-orange-500 cursor-pointer transition-all duration-300 border border-stone-200 flex flex-col relative group">
                        {!t.isVerified && (
                          <div className="absolute top-3 left-3 bg-stone-900/90 text-orange-400 text-[10px] uppercase font-black tracking-wider px-3 py-1.5 rounded-lg z-20 backdrop-blur-md border border-stone-700 shadow-lg">
                            Pendente
                          </div>
                        )}
                        
                        <div className="bg-gradient-to-r from-emerald-900 to-emerald-800 text-white p-5 pb-10 relative flex justify-between items-start">
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-orange-400 font-bold mb-1">Clube Atual</p>
                            <h3 className="font-black text-lg leading-tight truncate max-w-[180px]" title={t.teamName}>{t.teamName}</h3>
                          </div>
                          {t.isVerified && <CheckCircle size={22} className="text-orange-400 drop-shadow-md" />}
                        </div>

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
                            {getBirthdayStatus(t.birthDate) === 'today' && <PartyPopper size={20} className="text-rose-500 animate-bounce flex-shrink-0" />}
                            {getBirthdayStatus(t.birthDate) === 'upcoming' && <PartyPopper size={18} className="text-amber-500 flex-shrink-0" />}
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
                                <p className="font-bold text-stone-800 flex items-center gap-1"><Calendar size={12} className="text-orange-500 opacity-70"/> {t.birthDate} ({calculateAge(t.birthDate) ?? '-'} anos)</p>
                              ) : (
                                <p className="font-bold text-stone-800">-</p>
                              )}
                            </div>
                          </div>
                          
                          <div className="mt-auto space-y-2 pt-2 border-t border-stone-100">
                            {!t.isVerified && isAdminOrSuper && (
                              <button onClick={(e) => { e.stopPropagation(); handleApproveAthlete(t.id); }}
                                className="w-full bg-stone-900 text-orange-400 font-bold py-2.5 rounded-xl hover:bg-stone-800 transition-colors text-sm flex items-center justify-center gap-2">
                                <ShieldCheck size={16} /> Aprovar Ficha
                              </button>
                            )}
                            
                            {!t.isVerified && t.ownerId === firebaseUser?.uid && !isAdminOrSuper && (
                              <p className="text-center text-xs font-bold text-orange-600 bg-orange-50 p-2.5 rounded-xl border border-orange-100">
                                Em validação pela mesa
                              </p>
                            )}

                            {canManageAthletes && t.ownerId === firebaseUser?.uid && (
                              <button onClick={(e) => { e.stopPropagation(); handleEdit(t); }}
                                className="w-full bg-white text-emerald-700 font-bold py-2.5 rounded-xl border-2 border-emerald-100 hover:bg-emerald-50 hover:border-emerald-200 transition-colors text-xs flex items-center justify-center gap-2">
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
                            <th className="p-4">Categoria</th>
                            <th className="p-4">Local</th>
                            <th className="p-4">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {filteredTeams.map((t) => {
                            const age = calculateAge(t.birthDate);
                            const cat = getCategoryFromAge(age);
                            const catLabel = cat === 'sub17' ? 'Sub-17' : cat === 'sub20' ? 'Sub-20' : cat === 'profissional' ? 'Profissional' : '-';
                            const catColor = cat === 'sub17' ? 'bg-blue-100 text-blue-800' : cat === 'sub20' ? 'bg-purple-100 text-purple-800' : cat === 'profissional' ? 'bg-orange-100 text-orange-800' : 'bg-stone-100 text-stone-600';
                            return (
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
                                          {getBirthdayStatus(t.birthDate) === 'today' && <PartyPopper size={14} className="text-rose-500 animate-bounce flex-shrink-0" />}
                                          {getBirthdayStatus(t.birthDate) === 'upcoming' && <PartyPopper size={14} className="text-amber-500 flex-shrink-0" />}
                                        </p>
                                        {!t.isVerified && <span className="bg-orange-100 text-orange-600 text-[9px] uppercase font-black px-2 py-0.5 rounded flex-shrink-0">Pendente</span>}
                                        {t.isVerified && <CheckCircle size={14} className="text-orange-400" />}
                                      </div>
                                      <p className="text-xs text-stone-500">{t.nickname ? `"${t.nickname}"` : t.birthDate ? `${t.birthDate} (${age ?? '-'} anos)` : '-'}</p>
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
                                <td className="p-4">
                                  <span className={`${catColor} text-xs font-bold px-2.5 py-1 rounded-lg`}>{catLabel}</span>
                                </td>
                                <td className="p-4 text-sm text-stone-600 font-medium">
                                  <div className="flex flex-col">
                                    <span>{t.city || '-'}</span>
                                    <span className="text-xs text-stone-400">{t.state || '-'}</span>
                                  </div>
                                </td>
                                <td className="p-4">
                                  <div className="flex gap-2">
                                    {!t.isVerified && isAdminOrSuper && (
                                      <button onClick={(e) => { e.stopPropagation(); handleApproveAthlete(t.id); }}
                                        className="bg-stone-900 text-orange-400 font-bold px-3 py-1.5 rounded-lg hover:bg-stone-800 transition-colors text-xs flex items-center justify-center gap-1 shadow-sm">
                                        <ShieldCheck size={14} /> Aprovar
                                      </button>
                                    )}
                                    {canManageAthletes && t.ownerId === firebaseUser?.uid && (
                                      <button onClick={(e) => { e.stopPropagation(); handleEdit(t); }}
                                        className="bg-white text-emerald-700 font-bold px-3 py-1.5 rounded-lg border border-emerald-100 hover:bg-emerald-50 transition-colors text-xs flex items-center justify-center gap-1 shadow-sm">
                                        <Edit size={14} /> Editar
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ============ MONTAR TIME ============ */}
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
                    <button onClick={() => setSelectedSquadPlayers([])}
                      className="px-4 py-2 font-bold text-stone-500 hover:text-stone-800 transition-colors"
                      disabled={selectedSquadPlayers.length === 0}>
                      Limpar
                    </button>
                    <button onClick={() => window.print()}
                      className="bg-orange-500 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-orange-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={selectedSquadPlayers.length === 0}>
                      <Printer size={18} /> Imprimir / PDF
                    </button>
                  </div>
                </div>

                <div className="grid grid-flow-row md:grid-cols-3 gap-8">
                  <div className="md:col-span-1 print:hidden bg-white p-4 rounded-2xl border border-stone-200 h-[600px] flex flex-col">
                    <h3 className="font-bold text-sm uppercase text-stone-500 mb-4 px-2">Atletas Disponíveis</h3>
                    <div className="mb-3 px-2">
                      <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -mt-2 text-stone-400" />
                        <input type="text" placeholder="Buscar atleta..."
                          className="w-full bg-stone-50 border border-stone-200 p-2.5 pl-9 text-sm rounded-xl focus:border-emerald-500 focus:bg-white outline-none transition-all text-stone-700"
                          value={squadSearchTerm}
                          onChange={(e) => setSquadSearchTerm(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                      {filteredTeams.filter(t => !squadSearchTerm || (t.playerName?.toLowerCase().includes(squadSearchTerm.toLowerCase()) ?? false)).map(t => (
                        <div key={t.id}
                          className="flex items-center justify-between p-3 bg-stone-50 hover:bg-stone-100 rounded-xl cursor-pointer border border-transparent hover:border-stone-200 transition-colors"
                          onClick={() => {
                            if (!selectedSquadPlayers.find(p => p.id === t.id)) {
                              setSelectedSquadPlayers([...selectedSquadPlayers, { ...t, matchRole: t.position || 'Reserva' }]);
                            }
                          }}>
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
                        {[...selectedSquadPlayers].sort((a, b) => {
                          const order = ['Goleiro', 'Fixo', 'Ala DIREITA', 'Ala ESQUERDA', 'Ala', 'Pivô', 'Reserva', 'Treinador'];
                          let ia = order.indexOf((a as any).matchRole || a.position || '');
                          let ib = order.indexOf((b as any).matchRole || b.position || '');
                          if (ia === -1) ia = 99;
                          if (ib === -1) ib = 99;
                          return ia - ib;
                        }).map((player, idx) => (
                          <div key={player.id} className="flex items-center gap-4 p-4 border border-stone-200 rounded-xl relative group print:border-b print:border-stone-800 print:rounded-none">
                            <div className="font-black text-2xl text-stone-200 w-8 text-center print:text-stone-800">{idx + 1}</div>
                            <div className="w-12 h-12 rounded-full border border-stone-300 bg-stone-100 overflow-hidden flex-shrink-0 flex items-center justify-center print:w-16 print:h-16">
                              {player.playerPhoto ? <img src={player.playerPhoto} className="w-full h-full object-cover" /> : <Camera size={20} className="text-stone-400" />}
                            </div>
                            <div className="flex-1">
                              <p className="font-black text-lg text-stone-800 leading-none">{player.playerName}</p>
                              {player.nickname && <span className="text-xs text-orange-500 font-bold mr-3">"{player.nickname}"</span>}
                              
                              <div className="mt-2 flex items-center gap-2 print:hidden">
                                <select className="text-xs bg-stone-100 border border-stone-200 rounded-lg p-1 font-bold text-stone-600 outline-none focus:ring-1 focus:ring-emerald-500"
                                  value={(player as any).matchRole || player.position || ''}
                                  onChange={(e) => {
                                    setSelectedSquadPlayers(selectedSquadPlayers.map(p => p.id === player.id ? { ...p, matchRole: e.target.value } : p));
                                  }}>
                                  <option value="Goleiro">Goleiro</option>
                                  <option value="Fixo">Fixo</option>
                                  <option value="Ala">Ala</option>
                                  <option value="Ala DIREITA">Ala Direita</option>
                                  <option value="Ala ESQUERDA">Ala Esquerda</option>
                                  <option value="Pivô">Pivô</option>
                                  <option value="Reserva">Reserva</option>
                                  <option value="Treinador">Treinador</option>
                                </select>
                              </div>
                              
                              <p className="text-sm uppercase font-bold text-emerald-800 hidden print:block mt-1">
                                {(player as any).matchRole || player.position || '-'}
                              </p>
                            </div>
                            <div className="text-right hidden sm:block print:block">
                              <p className="text-[10px] uppercase font-bold text-stone-400">Time / Clube</p>
                              <p className="font-bold text-sm text-stone-700">{player.teamName}</p>
                            </div>
                            <button onClick={() => setSelectedSquadPlayers(selectedSquadPlayers.filter(p => p.id !== player.id))}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity print:hidden shadow-sm">
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

            {/* ============ PAINEL DE GESTÃO ============ */}
            {currentView === 'gestao' && isAdminOrSuper && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-3xl lg:text-4xl font-black text-emerald-900 leading-tight uppercase tracking-tight flex items-center gap-3">
                    <ShieldCheck className="text-orange-500" size={32} />
                    Painel de Gestão
                  </h2>
                  <p className="text-stone-500 font-medium mt-1">Gerencie convites, aprove usuários e controle acessos</p>
                </div>

                {/* Abas */}
                <div className="flex flex-wrap gap-2 bg-white p-2 rounded-2xl shadow-sm border border-stone-200">
                  <button onClick={() => setManageTab('pendentes')}
                    className={`flex-1 min-w-[140px] px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                      manageTab === 'pendentes' 
                        ? 'bg-orange-500 text-white shadow-md' 
                        : 'text-stone-600 hover:bg-stone-50'
                    }`}>
                    <Clock size={16} /> Pendentes
                    <span className={`px-2 py-0.5 rounded-full text-xs font-black ${manageTab === 'pendentes' ? 'bg-white text-orange-500' : 'bg-stone-100 text-stone-500'}`}>
                      {manageCounts.pendentes}
                    </span>
                  </button>
                  <button onClick={() => setManageTab('convites')}
                    className={`flex-1 min-w-[140px] px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                      manageTab === 'convites' 
                        ? 'bg-emerald-900 text-white shadow-md' 
                        : 'text-stone-600 hover:bg-stone-50'
                    }`}>
                    <Ticket size={16} /> Convites
                    <span className={`px-2 py-0.5 rounded-full text-xs font-black ${manageTab === 'convites' ? 'bg-white text-emerald-900' : 'bg-stone-100 text-stone-500'}`}>
                      {manageCounts.convites}
                    </span>
                  </button>
                  <button onClick={() => setManageTab('aprovados')}
                    className={`flex-1 min-w-[140px] px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                      manageTab === 'aprovados' 
                        ? 'bg-green-600 text-white shadow-md' 
                        : 'text-stone-600 hover:bg-stone-50'
                    }`}>
                    <UserCheck size={16} /> Aprovados
                    <span className={`px-2 py-0.5 rounded-full text-xs font-black ${manageTab === 'aprovados' ? 'bg-white text-green-600' : 'bg-stone-100 text-stone-500'}`}>
                      {manageCounts.aprovados}
                    </span>
                  </button>
                  <button onClick={() => setManageTab('rejeitados')}
                    className={`flex-1 min-w-[140px] px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                      manageTab === 'rejeitados' 
                        ? 'bg-red-600 text-white shadow-md' 
                        : 'text-stone-600 hover:bg-stone-50'
                    }`}>
                    <UserX size={16} /> Rejeitados
                    <span className={`px-2 py-0.5 rounded-full text-xs font-black ${manageTab === 'rejeitados' ? 'bg-white text-red-600' : 'bg-stone-100 text-stone-500'}`}>
                      {manageCounts.rejeitados}
                    </span>
                  </button>
                </div>

                {/* ABA: PENDENTES */}
                {manageTab === 'pendentes' && (
                  <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-stone-100">
                      <h3 className="text-xl font-black text-emerald-900 flex items-center gap-2">
                        <Clock className="text-amber-500" size={24} />
                        Contas Aguardando Aprovação
                      </h3>
                      <p className="text-stone-500 text-sm mt-1">Analise e aprove ou rejeite as solicitações</p>
                    </div>
                    {allUsers.filter(u => u.status === 'pending').length === 0 ? (
                      <div className="p-12 text-center">
                        <UserCheck size={48} className="mx-auto text-stone-200 mb-3" />
                        <p className="text-stone-500 font-bold">Nenhuma conta pendente de aprovação</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-stone-100">
                        {allUsers.filter(u => u.status === 'pending').map(u => (
                          <div key={u.uid} className="p-5 hover:bg-stone-50 transition-colors">
                            <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
                              <div className="flex items-center gap-4 flex-1">
                                <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                                  <Clock size={20} className="text-amber-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-black text-stone-900">{u.displayName}</p>
                                  <p className="text-sm text-stone-500 font-mono">{u.email}</p>
                                  {u.invitationCodeUsed && (
                                    <p className="text-xs text-stone-400 mt-1 flex items-center gap-1">
                                      <Ticket size={12} /> Convite: <span className="font-mono font-bold">{u.invitationCodeUsed}</span>
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-2 flex-shrink-0">
                                <button onClick={() => handleApproveUser(u.uid)}
                                  className="bg-green-600 text-white font-bold px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-1.5 shadow-sm">
                                  <UserCheck size={16} /> Aprovar
                                </button>
                                <button onClick={() => handleRejectUser(u.uid)}
                                  className="bg-red-600 text-white font-bold px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm flex items-center gap-1.5 shadow-sm">
                                  <UserX size={16} /> Rejeitar
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ABA: CONVITES */}
                {manageTab === 'convites' && (
                  <div className="space-y-6">
                    {/* Formulário para gerar novo convite */}
                    <div className="bg-white rounded-3xl border border-stone-200 shadow-sm p-6 md:p-8">
                      <h3 className="text-xl font-black text-emerald-900 mb-4 flex items-center gap-2">
                        <Ticket className="text-orange-500" size={24} />
                        Gerar Novo Convite
                      </h3>
                      <form onSubmit={handleCreateInvite} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5 ml-1">Nome do Convidado</label>
                            <input type="text" required value={newInviteName}
                              onChange={(e) => setNewInviteName(e.target.value)}
                              className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-medium"
                              placeholder="Ex: João Silva" />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1.5 ml-1">E-mail do Convidado</label>
                            <input type="email" required value={newInviteEmail}
                              onChange={(e) => setNewInviteEmail(e.target.value)}
                              className="w-full bg-stone-50 border border-stone-200 p-3 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all font-medium"
                              placeholder="joao@email.com" />
                          </div>
                        </div>
                        <button type="submit" disabled={loading}
                          className="bg-orange-500 text-white px-6 py-3 rounded-xl font-black uppercase tracking-wide hover:bg-orange-600 transition-all disabled:opacity-50 shadow-md flex items-center gap-2">
                          <PlusCircle size={18} /> {loading ? 'Gerando...' : 'Gerar Código de Convite'}
                        </button>
                        {errorMsg && (
                          <div className="p-3 bg-red-50 text-red-700 text-sm rounded-xl border border-red-200 font-medium">
                            {errorMsg}
                          </div>
                        )}
                      </form>

                      {/* Código gerado */}
                      {generatedInviteCode && (
                        <div className="mt-6 p-6 bg-gradient-to-br from-emerald-50 to-orange-50 rounded-2xl border-2 border-dashed border-emerald-300">
                          <p className="text-xs font-bold text-emerald-700 uppercase mb-2 flex items-center gap-1">
                            <CheckCircle size={14} /> Convite gerado com sucesso!
                          </p>
                          <p className="text-sm text-stone-600 mb-3">Envie este código para <b>{newInviteName || 'o convidado'}</b>:</p>
                          <div className="flex items-center gap-2 bg-white p-4 rounded-xl border border-stone-200">
                            <code className="flex-1 text-2xl font-mono font-black text-emerald-900 tracking-widest">{generatedInviteCode}</code>
                            <button onClick={() => handleCopyCode(generatedInviteCode)}
                              className="bg-emerald-900 text-white px-4 py-2 rounded-lg font-bold hover:bg-emerald-800 transition-colors flex items-center gap-2 text-sm">
                              <Copy size={16} /> Copiar
                            </button>
                          </div>
                          <button onClick={() => setGeneratedInviteCode(null)}
                            className="mt-3 text-sm text-stone-500 hover:text-stone-700 font-bold">
                            Fechar
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Lista de convites */}
                    <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                      <div className="p-6 border-b border-stone-100">
                        <h3 className="text-xl font-black text-emerald-900">Todos os Convites</h3>
                      </div>
                      {invitations.length === 0 ? (
                        <div className="p-12 text-center">
                          <Ticket size={48} className="mx-auto text-stone-200 mb-3" />
                          <p className="text-stone-500 font-bold">Nenhum convite gerado ainda</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-stone-50 border-b border-stone-200">
                              <tr className="text-xs uppercase font-black text-stone-500 tracking-wider">
                                <th className="p-4 text-left">Código</th>
                                <th className="p-4 text-left">Convidado</th>
                                <th className="p-4 text-left">E-mail</th>
                                <th className="p-4 text-left">Status</th>
                                <th className="p-4 text-left">Ações</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                              {invitations.map(inv => {
                                const statusConfig = {
                                  available: { label: 'Disponível', color: 'bg-blue-100 text-blue-800' },
                                  used: { label: 'Usado', color: 'bg-green-100 text-green-800' },
                                  cancelled: { label: 'Cancelado', color: 'bg-stone-100 text-stone-600' },
                                };
                                const cfg = statusConfig[inv.status];
                                return (
                                  <tr key={inv.id} className="hover:bg-stone-50/50">
                                    <td className="p-4">
                                      <code className="font-mono font-black text-sm text-emerald-900">{inv.code}</code>
                                    </td>
                                    <td className="p-4">
                                      <p className="font-bold text-stone-800 text-sm">{inv.inviteeName}</p>
                                    </td>
                                    <td className="p-4">
                                      <p className="text-sm text-stone-500 font-mono">{inv.inviteeEmail}</p>
                                    </td>
                                    <td className="p-4">
                                      <span className={`${cfg.color} text-xs font-bold px-2.5 py-1 rounded-lg`}>
                                        {cfg.label}
                                      </span>
                                    </td>
                                    <td className="p-4">
                                      {inv.status === 'available' && (
                                        <div className="flex gap-2">
                                          <button onClick={() => handleCopyCode(inv.code)}
                                            className="text-emerald-700 hover:bg-emerald-50 p-2 rounded-lg transition-colors"
                                            title="Copiar código">
                                            <Copy size={16} />
                                          </button>
                                          <button onClick={() => handleCancelInvite(inv.id)}
                                            className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors"
                                            title="Cancelar convite">
                                            <X size={16} />
                                          </button>
                                        </div>
                                      )}
                                      {inv.status === 'used' && inv.usedBy && (
                                        <p className="text-xs text-stone-400">Usado por: {allUsers.find(u => u.uid === inv.usedBy)?.displayName || 'usuário'}</p>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ABA: APROVADOS */}
                {manageTab === 'aprovados' && (
                  <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-stone-100">
                      <h3 className="text-xl font-black text-emerald-900 flex items-center gap-2">
                        <UserCheck className="text-green-600" size={24} />
                        Usuários Aprovados
                      </h3>
                    </div>
                    {allUsers.filter(u => u.status === 'approved').length === 0 ? (
                      <div className="p-12 text-center">
                        <Users size={48} className="mx-auto text-stone-200 mb-3" />
                        <p className="text-stone-500 font-bold">Nenhum usuário aprovado</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-stone-50 border-b border-stone-200">
                            <tr className="text-xs uppercase font-black text-stone-500 tracking-wider">
                              <th className="p-4 text-left">Nome</th>
                              <th className="p-4 text-left">E-mail</th>
                              <th className="p-4 text-left">Função</th>
                              <th className="p-4 text-left">Ações</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100">
                            {allUsers.filter(u => u.status === 'approved').map(u => (
                              <tr key={u.uid} className="hover:bg-stone-50/50">
                                <td className="p-4">
                                  <p className="font-bold text-stone-800">{u.displayName}</p>
                                </td>
                                <td className="p-4">
                                  <p className="text-sm text-stone-500 font-mono">{u.email}</p>
                                </td>
                                <td className="p-4">
                                  {u.role === 'super_admin' && (
                                    <span className="bg-yellow-100 text-yellow-800 text-xs font-black px-2.5 py-1 rounded-lg flex items-center gap-1 w-fit">
                                      <ShieldAlert size={12} /> SUPER ADMIN
                                    </span>
                                  )}
                                  {u.role === 'admin' && (
                                    <span className="bg-orange-100 text-orange-800 text-xs font-black px-2.5 py-1 rounded-lg flex items-center gap-1 w-fit">
                                      <ShieldCheck size={12} /> ADMIN
                                    </span>
                                  )}
                                  {u.role === 'user' && (
                                    <span className="bg-stone-100 text-stone-700 text-xs font-bold px-2.5 py-1 rounded-lg w-fit">
                                      Usuário
                                    </span>
                                  )}
                                </td>
                                <td className="p-4">
                                  {u.email === SUPER_ADMIN_EMAIL ? (
                                    <span className="text-xs text-stone-400 italic">Super Admin (você)</span>
                                  ) : (
                                    <div className="flex gap-2">
                                      {isSuperAdmin && u.role === 'user' && (
                                        <button onClick={() => handlePromoteToAdmin(u.uid)}
                                          className="bg-orange-500 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-orange-600 transition-colors text-xs flex items-center gap-1 shadow-sm">
                                          <ShieldCheck size={12} /> Promover a Admin
                                        </button>
                                      )}
                                      {isSuperAdmin && u.role === 'admin' && (
                                        <button onClick={() => handleDemoteToUser(u.uid)}
                                          className="bg-stone-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-stone-700 transition-colors text-xs flex items-center gap-1 shadow-sm">
                                          Rebaixar
                                        </button>
                                      )}
                                      {isSuperAdmin && (
                                        <button onClick={() => handleDeleteUser(u.uid)}
                                          className="bg-red-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-red-700 transition-colors text-xs flex items-center gap-1 shadow-sm">
                                          <Trash2 size={12} /> Deletar
                                        </button>
                                      )}
                                      {!isSuperAdmin && (
                                        <span className="text-xs text-stone-400 italic">Sem permissão</span>
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ABA: REJEITADOS */}
                {manageTab === 'rejeitados' && (
                  <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-stone-100">
                      <h3 className="text-xl font-black text-emerald-900 flex items-center gap-2">
                        <UserX className="text-red-600" size={24} />
                        Usuários Rejeitados
                      </h3>
                    </div>
                    {allUsers.filter(u => u.status === 'rejected').length === 0 ? (
                      <div className="p-12 text-center">
                        <UserCheck size={48} className="mx-auto text-stone-200 mb-3" />
                        <p className="text-stone-500 font-bold">Nenhum usuário rejeitado</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-stone-50 border-b border-stone-200">
                            <tr className="text-xs uppercase font-black text-stone-500 tracking-wider">
                              <th className="p-4 text-left">Nome</th>
                              <th className="p-4 text-left">E-mail</th>
                              <th className="p-4 text-left">Convite Usado</th>
                              <th className="p-4 text-left">Ações</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100">
                            {allUsers.filter(u => u.status === 'rejected').map(u => (
                              <tr key={u.uid} className="hover:bg-stone-50/50">
                                <td className="p-4">
                                  <p className="font-bold text-stone-800">{u.displayName}</p>
                                </td>
                                <td className="p-4">
                                  <p className="text-sm text-stone-500 font-mono">{u.email}</p>
                                </td>
                                <td className="p-4">
                                  <code className="text-xs font-mono font-bold text-stone-600">{u.invitationCodeUsed || '-'}</code>
                                </td>
                                <td className="p-4">
                                  <div className="flex gap-2">
                                    <button onClick={() => handleApproveUser(u.uid)}
                                      className="bg-green-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors text-xs flex items-center gap-1 shadow-sm">
                                      <UserCheck size={12} /> Reaprovar
                                    </button>
                                    {isSuperAdmin && (
                                      <button onClick={() => handleDeleteUser(u.uid)}
                                        className="bg-red-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-red-700 transition-colors text-xs flex items-center gap-1 shadow-sm">
                                        <Trash2 size={12} /> Deletar
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </main>

          {/* ============ MODAL DE DETALHES DO ATLETA ============ */}
          {selectedPlayer && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/80 backdrop-blur-sm shadow-2xl transition-opacity animate-in fade-in duration-300 print:absolute print:inset-0 print:bg-white print:p-0">
              <div className="bg-white rounded-[32px] w-full max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden flex flex-col relative animate-in zoom-in-95 duration-300 print:max-h-none print:overflow-visible print:rounded-none">
                <button onClick={() => setSelectedPlayer(null)}
                  className="absolute top-6 right-6 bg-stone-100 hover:bg-stone-200 text-stone-600 p-2 rounded-full transition-colors z-20 print:hidden">
                  <X size={24} />
                </button>
                
                <div className="bg-gradient-to-r from-emerald-900 to-emerald-800 p-6 md:p-8 relative text-white flex justify-between items-start print:hidden rounded-t-[32px]">
                  <div>
                    <p className="text-[10px] uppercase font-bold tracking-widest text-orange-400 mb-1">FICHA DE ATLETA</p>
                    <p className="opacity-80 text-sm">{selectedPlayer.teamName}</p>
                  </div>
                  <button onClick={() => window.print()}
                    className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl transition-colors flex items-center gap-2 font-bold text-sm">
                    <Printer size={18} /> Imprimir / PDF
                  </button>
                </div>

                <div className="hidden print:block text-center border-b border-stone-200 pb-4 mb-6">
                  <p className="text-sm uppercase font-bold tracking-widest text-stone-500 mb-1">FICHA DE ATLETA Oficial</p>
                  <h2 className="text-xl font-black text-stone-900">{selectedPlayer.teamName}</h2>
                </div>

                <div className="p-6 md:p-8">
                  <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 items-center sm:items-center bg-stone-50 print:bg-transparent p-6 rounded-3xl border border-stone-100 print:border-none print:p-0">
                    <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-4 border-white print:border-stone-200 bg-stone-200 overflow-hidden shadow-md shrink-0 flex items-center justify-center relative">
                      {selectedPlayer.playerPhoto ? (
                        <img src={selectedPlayer.playerPhoto} className={`w-full h-full object-cover ${!selectedPlayer.isVerified ? 'grayscale' : ''}`} alt={selectedPlayer.playerName} />
                      ) : (
                        <Camera size={48} className="text-stone-300" />
                      )}
                    </div>

                    <div className="text-center sm:text-left flex-1 space-y-2">
                      <h3 className="text-3xl md:text-4xl font-black text-emerald-950 print:text-stone-900 flex flex-wrap items-center justify-center sm:justify-start gap-2 leading-tight">
                        {selectedPlayer.playerName}
                        {getBirthdayStatus(selectedPlayer.birthDate) === 'today' && <PartyPopper size={24} className="text-rose-500 animate-bounce shrink-0 print:hidden" />}
                        {getBirthdayStatus(selectedPlayer.birthDate) === 'upcoming' && <PartyPopper size={24} className="text-amber-500 shrink-0 print:hidden" />}
                      </h3>
                      
                      {selectedPlayer.nickname && <p className="text-orange-500 font-bold text-xl leading-tight">"{selectedPlayer.nickname}"</p>}
                      
                      {selectedPlayer.birthDate && (
                        <div className="mt-3 inline-flex items-center gap-2 bg-white print:bg-stone-100 border border-stone-200 px-4 py-2 rounded-xl text-stone-600">
                          <Calendar size={16} className="text-orange-500 print:text-stone-500" /> 
                          <span className="font-medium text-sm">Nascimento:</span>
                          <span className="font-black text-stone-800 print:text-stone-900">{selectedPlayer.birthDate} ({calculateAge(selectedPlayer.birthDate) ?? '-'} anos)</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="w-full mt-6 space-y-6">
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
                            <p className="text-[10px] uppercase font-bold text-stone-400">Idade</p>
                            <p className="font-black text-stone-800 mt-1">{selectedPlayer.birthDate ? `${calculateAge(selectedPlayer.birthDate) ?? '-'} anos` : '-'}</p>
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
                              <Phone size={12} className={selectedPlayer.isWhatsapp ? "text-green-500 print:text-stone-600" : "text-stone-400"} />
                              Telefone
                            </p>
                            <p className="font-bold text-stone-800 text-lg">
                              {selectedPlayer.phone || '-'}
                              {selectedPlayer.isWhatsapp && <span className="ml-2 text-[10px] bg-green-100 text-green-700 print:bg-stone-100 print:text-stone-600 px-2 py-0.5 rounded-full font-black uppercase inline-block align-middle">WhatsApp</span>}
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
                  
                  {(selectedPlayer.ownerId === firebaseUser?.uid || (!selectedPlayer.isVerified && isAdminOrSuper)) && (
                    <div className="mt-8 flex justify-end gap-3 border-t border-stone-100 pt-6 print:hidden">
                      {!selectedPlayer.isVerified && isAdminOrSuper && (
                        <button onClick={() => { handleApproveAthlete(selectedPlayer.id); setSelectedPlayer(null); }}
                          className="bg-stone-900 text-orange-400 font-bold px-6 py-3 rounded-xl hover:bg-stone-800 transition-colors text-sm flex items-center justify-center gap-2 shadow-sm">
                          <ShieldCheck size={18} /> Aprovar Ficha
                        </button>
                      )}
                      {canManageAthletes && selectedPlayer.ownerId === firebaseUser?.uid && (
                        <button onClick={() => { handleEdit(selectedPlayer); setSelectedPlayer(null); }}
                          className="bg-white text-emerald-700 font-bold px-6 py-3 rounded-xl border border-emerald-100 hover:bg-emerald-50 transition-colors text-sm flex items-center justify-center gap-2 shadow-sm">
                          <Edit size={18} /> Editar Cadastro
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
