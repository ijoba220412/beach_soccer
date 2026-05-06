import fs from 'fs';
let content = fs.readFileSync('src/App.tsx', 'utf8');
content = content.replace('<p className="font-bold text-emerald-950 text-sm">{t.playerName}</p>', `<p className="font-bold text-emerald-950 text-sm flex items-center gap-1">
                                         {t.playerName}
                                         {getBirthdayStatus(t.birthDate) === 'today' && <PartyPopper size={14} className="text-rose-500 animate-bounce flex-shrink-0" title="Aniversário Hoje!" />}
                                         {getBirthdayStatus(t.birthDate) === 'upcoming' && <PartyPopper size={14} className="text-amber-500 flex-shrink-0" title="Aniversário chegando!" />}
                                       </p>`);
fs.writeFileSync('src/App.tsx', content);
