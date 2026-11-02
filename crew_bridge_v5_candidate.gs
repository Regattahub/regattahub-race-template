/**
 * RegattaHub V5 — Candidate Bridge for new-race Wizard.
 * BASE: archived VATHY 2026 crew bridge; not a verified live deployment.
 * NOT PRODUCTION. Defaults to READ-ONLY; activate only after EIO/Writer/Viewer
 * integration tests, schema mapping, and configuration checks.
 * DO NOT paste into the live VATHY project.
 */
const RHV5_CFG = Object.freeze({
  centralId:'__CENTRAL_SPREADSHEET_ID__', sourceId:'__SOURCE_SPREADSHEET_ID__',
  entriesTab:'__ENTRIES_TAB__',queueTab:'__QUEUE_TAB__',sourceTab:'__SOURCE_TAB__',
  race:'__RACE_KEY__',formId:'__JOTFORM_FORM_ID__',eventTitle:'__EVENT_TITLE__',
  repoSlug:'__RACE_REPO__',raceDeadline:'__CHANGE_DEADLINE_ISO__',
  tokenTTLHours:336,keyProp:'JOTFORM_PRIVATE_WRITE_API_KEY',
  allowWrites:false // The Wizard may enable only after a successful isolated test.
});
function RHV5_configReady_(){
  const values=[RHV5_CFG.centralId,RHV5_CFG.sourceId,RHV5_CFG.entriesTab,
    RHV5_CFG.queueTab,RHV5_CFG.sourceTab,RHV5_CFG.race,RHV5_CFG.formId,
    RHV5_CFG.eventTitle,RHV5_CFG.repoSlug,RHV5_CFG.raceDeadline];
  return values.every(x=>!!String(x).trim()&&!String(x).includes('__'))&&
    /^\d{9,}$/.test(RHV5_CFG.formId)&&
    /^[a-z0-9][a-z0-9-]*$/.test(RHV5_CFG.repoSlug)&&
    Number.isFinite(Date.parse(RHV5_CFG.raceDeadline));
}
function RHV5_requireReady_(){if(!RHV5_configReady_())throw Error('V5_CONFIG_INCOMPLETE');}

// Only read requests. JSONP is needed by existing prototype Github HTML.
function doGet(e){
  const p=(e&&e.parameter)||{};
  const cb=String(p.callback||'');
  if(!/^[A-Za-z_$][A-Za-z0-9_$]{0,100}$/.test(cb))
    return ContentService.createTextOutput('INVALID_CALLBACK').setMimeType(ContentService.MimeType.TEXT);
  let output;
  try {
    RHV5_requireReady_();
    if(p.action==='sailLookup') output=VCU_publicBoat_(String(p.sail||''));
    else if(p.action==='requestLink') output=VCU_invite_(String(p.submissionId||''));
    else if(p.action==='submissionLookup') output=VCU_read_(String(p.submissionId||''),String(p.editToken||''));
    else if(p.action==='saveStatus') output=VCU_saveStatus_(String(p.submissionId||''),String(p.editToken||''),String(p.revision||''));
    else throw Error('UNSUPPORTED_ACTION');
  }catch(err){
    output={ok:false,found:false,error:'Δεν ήταν δυνατή η ασφαλής φόρτωση της συμμετοχής. Ζητήστε νέο σύνδεσμο από τη γραμματεία.'};
  }
  const json=JSON.stringify(output).replace(/\u2028|\u2029/g,'');
  return ContentService.createTextOutput(cb+'('+json+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// NO outbound mail, NO sheet writes, NO tokens, NO triggers.
function RHC_table_(sheet){if(!sheet)throw Error('SHEET_NOT_FOUND');const vals=sheet.getDataRange().getDisplayValues();
  const map={};vals[0].forEach((h,i)=>map[String(h).trim()]=i);return {rows:vals.slice(1),map};}
function RHC_cell_(t,r,name){if(!Object.prototype.hasOwnProperty.call(t.map,name))throw Error('MISSING_HEADER '+name);
  return String(r[t.map[name]]==null?'':r[t.map[name]]).trim();}
function RHC_digits_(value){return String(value||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');}
function RHC_sha256_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s)).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');}
function RHC_constantTimeEqual_(a,b){if(a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0;}
function RHC_maskEmail_(s){return String(s).replace(/^(.{2})[^@]+(@.*)$/,'$1***$2');}


/**
 * VATHY 2026 — crew change write pathway, one current Jotform submission.
 * Installed alongside the established RHC_CFG authorization/token helpers.
 * External callers never receive a Jotform API key or an Edit URL.
 * New crew members remain pending EIO; they are NOT declared valid.
 */
const VCU_LIVE = Object.freeze({
  centralId:RHV5_CFG.centralId, sourceId:RHV5_CFG.sourceId,
  entriesTab:RHV5_CFG.entriesTab,queueTab:RHV5_CFG.queueTab,sourceTab:RHV5_CFG.sourceTab,
  formId:RHV5_CFG.formId,race:RHV5_CFG.race,keyProp:RHV5_CFG.keyProp,
  host:'https://regattahub.github.io',
  page:'https://regattahub.github.io/'+RHV5_CFG.repoSlug+'/crew_change.html',
  raceDeadline:RHV5_CFG.raceDeadline,
  q:Object.freeze({boat:'5',sail:'48',captainName:'93',captainCard:'55',captainClub:'33',
    secondCard:'542',secondName:'541',secondClub:'543',
    crewJson:'544',crewAA:'519',crewName:'520',crewCard:'521',crewClub:'522',preview:'523',
    changeText:'545',changeDate:'546',wosr1:'185',wosr2:'187'})
});

function VCU_publicBoat_(sail){
  // The central register is authoritative for boat discovery; the Jotform
  // Sheets integration can lag or lose historical rows after an edit.
  const n=VCU_digits_(sail);
  if(!n||n.length>8)return {ok:true,matches:[]};
  const E=RHC_table_(SpreadsheetApp.openById(VCU_LIVE.centralId).getSheetByName(VCU_LIVE.entriesTab));
  const rows=E.rows.filter(r=>
    RHC_cell_(E,r,'form_id')===VCU_LIVE.formId &&
    RHC_cell_(E,r,'race_prefix')===VCU_LIVE.race &&
    VCU_digits_(RHC_cell_(E,r,'sail_number'))===n);
  return {ok:true,matches:rows.slice(0,15).map(r=>({
    yacht_name:RHC_cell_(E,r,'yacht_name'),
    sail_number:RHC_cell_(E,r,'sail_number'),
    sail_letters:'GRE-',
    submission_id:RHC_cell_(E,r,'submission_id')
  })).filter(x=>/^\d{10,22}$/.test(x.submission_id))};
}

function VCU_invite_(id){
  RHV5_requireReady_();
  if(!/^\d{10,22}$/.test(id))return {ok:true,message:'Εφόσον η συμμετοχή υπάρχει, θα σταλεί προσωπικός σύνδεσμος.'};
  const lock=LockService.getScriptLock();if(!lock.tryLock(10000))return {ok:true,message:'Το αίτημα καταχωρίστηκε.'};
  try{
    const now=Date.now(),props=PropertiesService.getScriptProperties(),k='VCU_INVITE_LIMIT_'+id;
    let lim={t:0,count:0,day:''};try{lim=JSON.parse(props.getProperty(k)||'{}');}catch(_){ }
    const day=Utilities.formatDate(new Date(now),'Europe/Athens','yyyy-MM-dd');
    if(lim.day!==day)lim={day,t:0,count:0};
    if(now-Number(lim.t||0)<10*60*1000||Number(lim.count||0)>=3)
      return {ok:true,message:'Εφόσον η συμμετοχή υπάρχει, ο σύνδεσμος αποστέλλεται στην καταχωρημένη διεύθυνση.'};
    const x=VCU_identity_(id);
    if(MailApp.getRemainingDailyQuota()<1) throw Error('EMAIL_QUOTA_EXHAUSTED');
    const token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
    props.setProperty('RHC_TOKEN_'+id,JSON.stringify({hash:RHC_sha256_(token),expiry:now+RHV5_CFG.tokenTTLHours*3600*1000}));
    const link=VCU_LIVE.page+'#submissionId='+encodeURIComponent(id)+'&editToken='+encodeURIComponent(token);
    MailApp.sendEmail({to:x.email,name:'RegattaHub — '+RHV5_CFG.eventTitle,
      subject:RHV5_CFG.eventTitle+' — Προσωπικός σύνδεσμος αλλαγής πληρώματος',
      body:'Σκάφος: '+x.yacht+'\n\nΟ προσωπικός σύνδεσμος τροποποίησης πληρώματος είναι:\n'+link+'\n\n'+
      'Οι αλλαγές ελέγχονται στη συνέχεια από την ΕΙΟ. Ισχύς συνδέσμου: '+RHV5_CFG.tokenTTLHours+' ώρες. Μην τον κοινοποιείτε.\n\nRegattaHub'});
    props.setProperty(k,JSON.stringify({day,t:now,count:Number(lim.count||0)+1}));
    return {ok:true,message:'Εφόσον η συμμετοχή υπάρχει, ο σύνδεσμος αποστέλλεται στην καταχωρημένη διεύθυνση.'};
  }catch(err){Logger.log('VCU_INVITE_FAIL '+String(err.message||err).slice(0,120));
    return {ok:true,message:'Εάν υπάρχει αντίστοιχη συμμετοχή, ο σύνδεσμος αποστέλλεται στο email της.'};
  }finally{lock.releaseLock();}
}

function VCU_saveStatus_(id,token,revision){
  VCU_validateToken_(id,token);
  const raw=PropertiesService.getScriptProperties().getProperty('VCU_LAST_SAVE_'+id);
  if(!raw)return {ok:true,confirmed:false};
  const ack=JSON.parse(raw);
  if(ack.fromRevision===revision&&Date.now()-ack.at<5*60*1000)
    return {ok:true,confirmed:true,updated:true,submissionId:id,revision:ack.revision,queuedNewCards:ack.queuedNewCards};
  return {ok:true,confirmed:false};
}

function VCU_validateToken_(id,token){
  if(!/^\d{10,22}$/.test(id)||!/^[a-f0-9]{64}$/.test(token))throw Error('INVALID_PERSONAL_LINK');
  const raw=PropertiesService.getScriptProperties().getProperty('RHC_TOKEN_'+id);
  if(!raw)throw Error('MISSING_PERSONAL_LINK');
  const x=JSON.parse(raw);
  if(Date.now()>Number(x.expiry||0))throw Error('EXPIRED_PERSONAL_LINK');
  if(!RHC_constantTimeEqual_(RHC_sha256_(token),String(x.hash||'')))throw Error('INVALID_PERSONAL_LINK');
  return VCU_identity_(id);
}

function VCU_identity_(id){
  // Strict identity is established by the unique central entry AND by the
  // exact same Jotform submission/form. Never trust a sail number alone.
  if(!/^\d{10,22}$/.test(id))throw Error('INVALID_SUBMISSION_ID');
  const E=RHC_table_(SpreadsheetApp.openById(VCU_LIVE.centralId).getSheetByName(VCU_LIVE.entriesTab));
  const er=E.rows.filter(r=>RHC_cell_(E,r,'submission_id')===id &&
    RHC_cell_(E,r,'form_id')===VCU_LIVE.formId &&
    RHC_cell_(E,r,'race_prefix')===VCU_LIVE.race);
  if(er.length!==1)throw Error('CENTRAL_SUBMISSION_NOT_UNIQUE');
  const boat=RHC_cell_(E,er[0],'yacht_name');
  const sail=VCU_digits_(RHC_cell_(E,er[0],'sail_number'));
  const submission=VCU_api_('get','/submission/'+encodeURIComponent(id));
  if(String(submission.id)!==id||String(submission.form_id)!==VCU_LIVE.formId)
    throw Error('JOTFORM_SUBMISSION_IDENTITY_MISMATCH');
  const A=submission.answers||{},get=q=>String(A[q]?.answer??'').trim();
  if(get('5').toUpperCase()!==boat.toUpperCase()||VCU_digits_(get('48'))!==sail)
    throw Error('JOTFORM_BOAT_IDENTITY_MISMATCH');
  // Private email comes from the same trusted Jotform submission, never a public request.
  if(VCU_normal_(A['316']?.text)!==VCU_normal_('e-mail ΕΠΙΚΟΝΩΝΙΑΣ'))
    throw Error('JOTFORM_EMAIL_FIELD_MISMATCH');
  const email=get('316');
  if(!/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(email))throw Error('NO_CONTACT_EMAIL');
  // Preserve sheet data where it exists; missing integration rows are not errors.
  const S=RHC_table_(SpreadsheetApp.openById(VCU_LIVE.sourceId).getSheetByName(VCU_LIVE.sourceTab));
  const sr=S.rows.filter(r=>RHC_cell_(S,r,'Submission ID')===id);
  if(sr.length>1)throw Error('DUPLICATE_SOURCE_SUBMISSION');
  if(sr.length===1 && (RHC_cell_(S,sr[0],'ΟΝΟΜΑ ΣΚΑΦΟΥΣ').toUpperCase()!==boat.toUpperCase() ||
     VCU_digits_(RHC_cell_(S,sr[0],'ΑΡΙΘΜΟΣ ΠΑΝΙΟΥ'))!==sail))
    throw Error('SOURCE_IDENTITY_MISMATCH');
  return {id,boat,sail,email,editUrl:'',jotformAnswers:A,
    sourceTable:S,sourceRow:sr.length?sr[0]:null,entryTable:E,entryRow:er[0]};
}

function VCU_api_(method,path,payload){
  const key=String(PropertiesService.getScriptProperties().getProperty(VCU_LIVE.keyProp)||'').trim();
  if(!key)throw Error('PRIVATE_JOTFORM_KEY_MISSING_IN_BRIDGE');
  const opts={method,headers:{APIKEY:key},followRedirects:false,muteHttpExceptions:true};
  if(payload!==undefined){opts.payload=payload;opts.contentType='application/x-www-form-urlencoded; charset=UTF-8';}
  const res=UrlFetchApp.fetch('https://eu-api.jotform.com'+path,opts);
  if(res.getResponseCode()!==200)throw Error('JOTFORM_HTTP_'+res.getResponseCode());
  let j;try{j=JSON.parse(res.getContentText());}catch(_){throw Error('JOTFORM_INVALID_JSON');}
  if(Number(j.responseCode)!==200||!j.content)throw Error('JOTFORM_ERROR');
  return j.content;
}

function VCU_current_(id,identity){
  const f=VCU_api_('get','/submission/'+encodeURIComponent(id));
  if(String(f.id)!==id||String(f.form_id)!==VCU_LIVE.formId)throw Error('WRONG_JOTFORM_SUBMISSION');
  const q=VCU_LIVE.q,A=f.answers||{},ans=k=>String(A[q[k]]?.answer??'').trim();
  for(const [k,label] of Object.entries({boat:'ΟΝΟΜΑ ΣΚΑΦΟΥΣ',sail:'ΑΡΙΘΜΟΣ ΠΑΝΙΟΥ',crewJson:'CREW_JSON',
    crewCard:'CrewPDF_CARD',captainCard:'ΑΡΙΘΜΟΣ  ΑΘΛ. ΔΕΛΤΙΟΥ ΕΙΟ'}))
      if(VCU_normal_(A[q[k]]?.text)!==VCU_normal_(label))throw Error('JOTFORM_FIELD_MISMATCH_'+k);
  if(ans('boat').toUpperCase()!==identity.boat.toUpperCase()||VCU_digits_(ans('sail'))!==identity.sail)
    throw Error('JOTFORM_BOAT_MISMATCH');
  const captain={name:ans('captainName'),card:VCU_digits_(ans('captainCard')),club:ans('captainClub')};
  if(!captain.card)throw Error('NO_CAPTAIN');
  const second=VCU_digits_(ans('secondCard'))?{card:VCU_digits_(ans('secondCard')),name:ans('secondName'),club:ans('secondClub')}:null;
  let members=[];
  const raw=ans('crewJson');
  if(raw){try{const parsed=JSON.parse(raw);if(Array.isArray(parsed))members=parsed.map(m=>({card:VCU_digits_(m.card),name:String(m.name||'').trim(),club:String(m.club||'').trim()}));}catch(_){}}
  if(!members.length){
    const cards=ans('crewCard').split(/\r?\n/).map(VCU_digits_).filter(Boolean);
    const names=ans('crewName').split(/\r?\n/),clubs=ans('crewClub').split(/\r?\n/);
    members=cards.map((card,i)=>({card,name:names[i]||'',club:clubs[i]||''}));
  }
  const all=[captain.card,...(second?[second.card]:[]),...members.map(m=>m.card)];
  if(all.length<2||all.length>15||new Set(all).size!==all.length||all.some(x=>!/^\d{3,12}$/.test(x)))
    throw Error('JOTFORM_CREW_INCONSISTENT');
  const revision=RHC_sha256_(JSON.stringify({cards:all,crew:members,second,wosr:[ans('wosr1'),ans('wosr2')]}));
  return {raw:f,answers:A,answer:ans,captain,second,members,revision};
}
function VCU_read_(id,token){
  const identity=VCU_validateToken_(id,token),current=VCU_current_(id,identity);
  const a=current.answer,A=current.answers;
  const fromSheet=(header,fallback)=>identity.sourceRow
    ? RHC_cell_(identity.sourceTable,identity.sourceRow,header):fallback;
  return {ok:true,found:true,multiple:false,data:{
    submission_id:id,yacht_name:identity.boat,sail_number:identity.sail,
    sail_letters:fromSheet('ΓΡΑΜΜΑΤΑ ΠΑΝΙΟΥ','GRE-'),
    yacht_type:fromSheet('ΤΥΠΟΣ ΣΚΑΦΟΥΣ',String(A['13']?.answer||'')),
    club:fromSheet('ΟΜΙΛΟΣ',String(A['17']?.answer||'')),
    captain_name:current.captain.name,captain_card:current.captain.card,captain_club:current.captain.club,
    second_captain_name:current.second?.name||'',second_captain_card:current.second?.card||'',
    second_captain_club:current.second?.club||'',crew_members:current.members,
    access_mode:'READ_ONLY',revision:current.revision,
    wosr_member_1:a('wosr1'),wosr_member_2:a('wosr2')
  }};
}

// Server update: never invoked from unauthenticated sail-only search.
function VCU_save_(p){
  RHV5_requireReady_();
  if(!RHV5_CFG.allowWrites)throw Error('V5_WRITES_DISABLED_UNTIL_PREFLIGHT');
  const id=String(p.submissionId||''),token=String(p.editToken||'');
  const lock=LockService.getScriptLock();if(!lock.tryLock(20000))throw Error('BUSY_RETRY');
  try{
    if(Date.now()>=new Date(VCU_LIVE.raceDeadline).getTime())throw Error('CHANGE_PERIOD_CLOSED');
    const identity=VCU_validateToken_(id,token),cur=VCU_current_(id,identity),q=VCU_LIVE.q;
    const payload=JSON.parse(String(p.payload||''));
    if(String(payload.revision||'')!==cur.revision)throw Error('CREW_CHANGED_RELOAD_REQUIRED');
    const card=VCU_digits_,captain=cur.captain.card;
    if(!Array.isArray(payload.members)||payload.members.length<1||payload.members.length>14)throw Error('CREW_SIZE_INVALID');
    const members=payload.members.map(x=>({card:card(x.card),name:String(x.name||'').trim().slice(0,160),club:String(x.club||'').trim().slice(0,160)}));
    if(members.some(x=>!/^\d{3,12}$/.test(x.card)))throw Error('INVALID_CARD');
    const second=payload.second?.card?{
      card:card(payload.second.card),name:String(payload.second.name||'').trim().slice(0,160),
      club:String(payload.second.club||'').trim().slice(0,160)}:null;
    if(second&&!/^\d{3,12}$/.test(second.card))throw Error('INVALID_SECOND_CAPTAIN');
    const all=[captain,...(second?[second.card]:[]),...members.map(x=>x.card)];
    if(all.length>15||new Set(all).size!==all.length)throw Error('DUPLICATE_OR_TOO_MANY_CARDS');
    // Only verified EIO names or earlier saved names are trusted; new card names are blank until EIO.
    const known=new Map([cur.captain,...(cur.second?[cur.second]:[]),...cur.members].map(x=>[x.card,x]));
    members.forEach(x=>{const trusted=known.get(x.card);x.name=trusted?.name||'';x.club=trusted?.club||'';});
    if(second){const trusted=known.get(second.card);second.name=trusted?.name||'';second.club=trusted?.club||'';}
    const selected=(Array.isArray(payload.wosr)?payload.wosr:[]).map(card).filter(Boolean);
    if(selected.length!==0&&selected.length!==2)throw Error('SELECT_TWO_WSOSR_OR_NONE');
    if(new Set(selected).size!==selected.length||selected.some(x=>!all.includes(x)))throw Error('WSOSR_CARD_NOT_IN_CREW');
    const byCard=new Map([cur.captain,...(second?[second]:[]),...members].map(x=>[x.card,x]));
    // Leaving WS OSR untouched must never silently delete previously declared choices.
    const previousWosr=[cur.answer('wosr1'),cur.answer('wosr2')];
    if(!selected.length){
      const removed=[cur.captain,...(cur.second?[cur.second]:[]),...cur.members]
        .filter(m=>!all.includes(m.card));
      const invalid=removed.some(m=>previousWosr.some(v=>(m.name&&VCU_normal_(v)===VCU_normal_(m.name))||
        (m.card&&String(v).includes(m.card))));
      if(invalid)throw Error('WSOSR_REPLACEMENT_REQUIRED');
    }
    const wosr=selected.length?selected.map(c=>byCard.get(c)?.name||'Αρ. δελτίου '+c+' — έλεγχος εκκρεμεί'):previousWosr;
    const preview='Α/Α            ΟΝΟΜΑΤΕΠΩΝΥΜΟ             ΑΡ. ΔΕΛΤΙΟ                 ΟΜΙΛΟΣ\n'+
       '─────────────────────────────────────────────────────────────────────────────────────────\n'+
       members.map((m,i)=>' '+(i+1)+'   '+(m.name||'')+'    '+m.card+'    '+(m.club||'')).join('\n');
    const now=Utilities.formatDate(new Date(),'Europe/Athens','dd/MM/yyyy HH:mm:ss');
    // A Jotform API update may ignore empty values; never let an old PDF name
    // persist under a replacement card. Writer V5 must verify exactly this
    // card-bound placeholder before converting it to EIO-verified identity.
    const pendingName=member=>member.name||('ΕΚΚΡΕΜΕΙ ΕΙΟ - ΔΕΛΤΙΟ '+member.card);
    const pendingClub=member=>member.club||('ΕΚΚΡΕΜΕΙ ΕΙΟ - ΔΕΛΤΙΟ '+member.card);
    const desired={
      [q.secondCard]:second?.card||'',[q.secondName]:second?.name||'',[q.secondClub]:second?.club||'',
      [q.crewJson]:JSON.stringify(members),[q.crewAA]:members.map((_,i)=>i+1).join('\n'),
      [q.crewName]:members.map(pendingName).join('\n'),[q.crewCard]:members.map(x=>x.card).join('\n'),
      [q.crewClub]:members.map(pendingClub).join('\n'),[q.preview]:preview,
      [q.changeText]:'Τροποποίηση πληρώματος από RegattaHub V5 — έλεγχος νέων δελτίων μόνο',
      [q.changeDate]:now,[q.wosr1]:wosr[0]||'',[q.wosr2]:wosr[1]||''
    };
    // Guard the central data pathway BEFORE mutating Jotform: if the sheet
    // or the identity is missing, fail safely without a half-finished update.
    VCU_queuePreflightV5_(identity,all);
    const formBody=Object.keys(desired).map(k=>encodeURIComponent('submission['+k+']')+'='+encodeURIComponent(desired[k])).join('&');
    VCU_api_('post','/submission/'+id,formBody);
    const fresh=VCU_current_(id,identity);
    if(fresh.members.length!==members.length||fresh.members.some((m,i)=>m.card!==members[i].card)||
        String(fresh.second?.card||'')!==String(second?.card||'')) throw Error('JOTFORM_READBACK_FAILED');
    // PDF names/clubs must also agree with this exact card sequence. Jotform
    // silently dropping an empty-field update may otherwise mislabel a PDF.
    for(const field of ['crewCard','crewName','crewClub']){
      const stored=String(fresh.answer(field)||'').replace(/\r/g,'').trim();
      const expected=String(desired[q[field]]||'').replace(/\r/g,'').trim();
      if(stored!==expected)throw Error('JOTFORM_PDF_READBACK_MISMATCH_'+field);
    }
    // Queue + central update happens after a verified Jotform write.
    const sync=VCU_syncQueue_(identity,all,desired,now);
    PropertiesService.getScriptProperties().setProperty('VCU_LAST_SAVE_'+id,JSON.stringify({
      fromRevision:String(payload.revision),revision:fresh.revision,queuedNewCards:sync.newCards,
      at:Date.now(),submissionId:id
    }));
    return {ok:true,updated:true,submissionId:id,crewCount:all.length,
      queuedNewCards:sync.newCards,pendingEio:true,revision:fresh.revision};
  }finally{lock.releaseLock();}
}

function VCU_syncQueue_(identity,cards,desired,when){
  const c=SpreadsheetApp.openById(VCU_LIVE.centralId),entry=c.getSheetByName(VCU_LIVE.entriesTab),queue=c.getSheetByName(VCU_LIVE.queueTab);
  if(!entry||!queue)throw Error('QUEUE_TABS_MISSING');
  const E=entry.getDataRange().getDisplayValues(),H={},Q=queue.getDataRange().getDisplayValues(),J={};
  E[0].forEach((x,i)=>H[String(x).trim()]=i);Q[0].forEach((x,i)=>J[String(x).trim()]=i);
  const req=(map,keys)=>keys.forEach(k=>{if(!Number.isInteger(map[k]))throw Error('COLUMN_MISSING_'+k);});
  req(H,['submission_id','race_prefix','form_id','cards_raw','total_cards','checked_cards','check_status','jotform_sync','results_json']);
  req(J,['task_id','submission_id','card','queue_status','queued_at','athlete_name','athlete_club','eio_status','checked_at','attempt_count','error','source_page','result_json']);
  const idx=E.slice(1).map((r,i)=>({r,row:i+2})).filter(x=>String(x.r[H.submission_id])===identity.id&&
      String(x.r[H.race_prefix])===VCU_LIVE.race&&String(x.r[H.form_id])===VCU_LIVE.formId);
  if(idx.length!==1)throw Error('CENTRAL_ENTRY_MISMATCH');
  const current=Q.slice(1).map((r,i)=>({r,row:i+2})).filter(x=>String(x.r[J.submission_id])===identity.id);
  const keep=new Set(cards),removed=current.filter(x=>!keep.has(VCU_digits_(x.r[J.card])));
  // V5: Never delete past EIO evidence. Removed crew is excluded from the
  // current central cards_raw, but retained in queue/history for audit.
  if(removed.length)Logger.log('RHV5_HISTORICAL_QUEUE_RETAINED '+JSON.stringify({submissionId:identity.id,removedCards:removed.map(x=>VCU_digits_(x.r[J.card]))}));
  const existing=new Map(current.filter(x=>keep.has(VCU_digits_(x.r[J.card]))).map(x=>[VCU_digits_(x.r[J.card]),x.r]));
  const newly=[];
  for(const value of cards){
    if(existing.has(value))continue;
    const vals=Array(Q[0].length).fill('');
    const fields={task_id:'Q-'+identity.id+'-'+value,submission_id:identity.id,card:value,
      queue_status:'Εκκρεμεί',queued_at:when,attempt_count:'0'};
    Object.keys(fields).forEach(k=>vals[J[k]]=fields[k]);
    queue.appendRow(vals);newly.push(value);
  }
  const alreadyEio=cards.filter(card=>{
    const x=existing.get(card);
    return x&&['Active','Expired','Inactive','Suspended'].includes(String(x[J.eio_status]))&&
      String(x[J.athlete_name]||'').trim()&&String(x[J.athlete_club]||'').trim()&&
      ['Ελέγχθηκε','Χρειάζεται επανέλεγχο'].includes(String(x[J.queue_status]));
  });
  const verified=alreadyEio.length;
  const active=alreadyEio.filter(card=>String(existing.get(card)[J.eio_status])==='Active').length;
  const row=idx[0].row;
  const updates={cards_raw:cards.join(' '),total_cards:cards.length,checked_cards:verified,
    check_status:verified===cards.length&&active===cards.length?'Ελέγχθηκε':'Χρειάζεται επανέλεγχο',
    jotform_sync:'Εκκρεμεί',results_json:''};
  for(const [k,v] of Object.entries(updates))entry.getRange(row,H[k]+1).setValue(v);
  // Update integration sheet only when its matching original row still exists.
  // The central register is authoritative; lack of a source row cannot abort a
  // successful Jotform + queue update.
  const S=identity.sourceTable;
  const source=SpreadsheetApp.openById(VCU_LIVE.sourceId).getSheetByName(VCU_LIVE.sourceTab);
  const src=source.getDataRange().getDisplayValues();
  const sr=src.slice(1).map((values,i)=>({values,index:i+2})).filter(x=>
    String(x.values[S.map['Submission ID']]||'').trim()===identity.id);
  if(sr.length>1)throw Error('SOURCE_SUBMISSION_NOT_UNIQUE');
  if(sr.length===1){
    const sourceUpdates={'Προεπισκόπηση Πληρώματος':desired[VCU_LIVE.q.preview],
      'ΑΡ.ΔΕΤΛΥΙΟΥ ΔΕΥΤΕΡΟΥ ΚΥΒΕΡΝΗΤΗ':desired[VCU_LIVE.q.secondCard],
      'Μέλος πληρώματος (1) εξοικειωμένο με τις διαδικασίες WS OSR 6.05.3:':desired[VCU_LIVE.q.wosr1],
      'Μέλος πληρώματος (2) εξοικειωμένο με τις διαδικασίες WS OSR 6.05.3:':desired[VCU_LIVE.q.wosr2],
      'Last Update Date':when};
    for(const [header,value] of Object.entries(sourceUpdates))if(Number.isInteger(S.map[header]))
      source.getRange(sr[0].index,S.map[header]+1).setValue(value);
  }else Logger.log('VCU_SOURCE_ROW_MISSING_SAFE_SKIP '+identity.id);
  SpreadsheetApp.flush();
  return {newCards:newly.length};
}
function VCU_digits_(v){return String(v||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');}
function VCU_normal_(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase();}

/** Safe HTML response for a real form POST; no untrusted content is interpolated into code. */
function doPost(e){
  let result;
  try{
    const p=e?.parameter||{};
    if(p.action!=='updateCrew')throw Error('UNKNOWN_ACTION');
    result=VCU_save_(p);
  }catch(err){
    Logger.log('VCU_SAVE_FAILURE '+String(err.message||err).slice(0,180));
    result={ok:false,error:String(err.message||err).slice(0,130)};
  }
  const json=JSON.stringify(result).replace(/</g,'\\u003c').replace(/\u2028|\u2029/g,'');
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><script>'+ 
    'window.top.postMessage({app:"regattahub-crew-v5",result:'+json+'},"'+VCU_LIVE.host+'");'+
    'window.parent.postMessage({app:"regattahub-crew-v5",result:'+json+'},"'+VCU_LIVE.host+'");</script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function VCU_READY_CHECK(){
  const c=VCU_LIVE,k=PropertiesService.getScriptProperties().getProperty(c.keyProp)||'';
  const output={race:c.race,form:c.formId,apiKeyPresent:!!k,
    tokenCount:PropertiesService.getScriptProperties().getKeys().filter(x=>x.indexOf('RHC_TOKEN_')===0).length,
    writeEndpointInstalled:true,needsNewDeployment:true,readOnly:false,
    caution:'No mutation executed by this function'};
  Logger.log('VCU_READY_CHECK '+JSON.stringify(output));return output;
}



/** READ-ONLY queue preflight. Call BEFORE Jotform mutation. */
function VCU_queuePreflightV5_(identity,cards){
  const central=SpreadsheetApp.openById(VCU_LIVE.centralId);
  const entry=central.getSheetByName(VCU_LIVE.entriesTab),queue=central.getSheetByName(VCU_LIVE.queueTab);
  if(!entry||!queue)throw Error('V5_QUEUE_SHEETS_MISSING');
  const E=RHC_table_(entry),Q=RHC_table_(queue);
  ['submission_id','race_prefix','form_id','cards_raw','total_cards','checked_cards','check_status','jotform_sync','results_json'].forEach(k=>{
    if(!Number.isInteger(E.map[k]))throw Error('V5_CENTRAL_HEADER_MISSING_'+k);
  });
  ['task_id','submission_id','card','queue_status','eio_status','athlete_name','athlete_club','result_json'].forEach(k=>{
    if(!Number.isInteger(Q.map[k]))throw Error('V5_QUEUE_HEADER_MISSING_'+k);
  });
  const matches=E.rows.filter(r=>RHC_cell_(E,r,'submission_id')===identity.id&&
    RHC_cell_(E,r,'form_id')===VCU_LIVE.formId&&RHC_cell_(E,r,'race_prefix')===VCU_LIVE.race);
  if(matches.length!==1)throw Error('V5_CENTRAL_IDENTITY_NOT_UNIQUE');
  const queueRows=Q.rows.filter(r=>RHC_cell_(Q,r,'submission_id')===identity.id);
  const counts=new Map();for(const r of queueRows){const c=VCU_digits_(RHC_cell_(Q,r,'card'));counts.set(c,(counts.get(c)||0)+1);}
  // Multiple queue rows for a card require explicit reconciliation, never silent reuse.
  for(const c of cards)if((counts.get(c)||0)>1)throw Error('V5_DUPLICATE_QUEUE_CARD_'+c);
  const centralCards=RHC_cell_(E,matches[0],'cards_raw').split(/[\s,;]+/).map(VCU_digits_).filter(Boolean);
  const centralSet=new Set(centralCards);
  const missingPrior=centralCards.filter(c=>!queueRows.some(r=>VCU_digits_(RHC_cell_(Q,r,'card'))===c));
  if(missingPrior.length)throw Error('V5_PRIOR_QUEUE_PROOF_MISSING_'+missingPrior.join('_'));
  return {id:identity.id,retained:cards.filter(c=>centralSet.has(c)),added:cards.filter(c=>!centralSet.has(c)),removed:centralCards.filter(c=>!cards.includes(c))};
}

/** V5 preflight: validates Wizard substitution; zero emails/Jotform/Sheet writes. */
function RHV5_BRIDGE_PREFLIGHT(){
  const ready=RHV5_configReady_();
  const report={mode:'READ_ONLY',ready,allowWrites:RHV5_CFG.allowWrites,
    race:RHV5_CFG.race,formId:RHV5_CFG.formId,
    keysRequired:[RHV5_CFG.keyProp],jotformWrites:0,queueWrites:0,emails:0};
  Logger.log('RHV5_BRIDGE_PREFLIGHT '+JSON.stringify(report));return report;
}
