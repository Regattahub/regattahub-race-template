/**
 * RegattaHub V5 — WRITER CANDIDATE (development only).
 * Source: archived VATHY Writer 2026-11-01, generalized for the New Race Wizard.
 * Standalone Apps Script only; do NOT paste into active VATHY or an existing Writer.
 * NOT PRODUCTION: write and trigger enablement are BOTH disabled by default.
 * Fill in race-specific settings, validate QIDs, run READ-ONLY preflight, test
 * against a disposable Jotform submission and isolated central sheets first.
 * EIO proofs are consumed from the verified queue, NEVER fabricated/refetched.
 */
const RHVM_WRITER_INVALID_SYNC = 'Ενημερώθηκαν στοιχεία ΕΙΟ — ΜΗ ΕΓΚΥΡΟ';
const RHVM_WRITER_APPROVED_SYNC = 'Συγχρονίστηκε';
const RHVM_WRITER_PENDING_SYNC = 'Εκκρεμεί';
const RHVM_WRITER_ALLOWED_STATES = Object.freeze(['Active','Expired','Inactive','Suspended']);
const RHVM_WRITER_ALLOWED_CHECKS = Object.freeze(['Ελέγχθηκε','Χρειάζεται επανέλεγχο']);
const RHVM_WRITER_REVISION = 'REGATTAHUB_V5_WRITER_CANDIDATE_20261102';
const RHV5_WRITER_MODE=Object.freeze({
  allowWrites:false,
  allowTriggers:false
});
const RHVM_WRITER_CONF=Object.freeze({
  centralId:'__CENTRAL_SPREADSHEET_ID__',
  entriesTab:'__ENTRIES_TAB__',queueTab:'__QUEUE_TAB__',
  formId:'__JOTFORM_FORM_ID__',race:'__RACE_KEY__',
  apiRoot:'https://eu-api.jotform.com',apiKeyProp:'JOTFORM_PRIVATE_WRITE_API_KEY',
  handler:'RHVM_WRITER_TICK',maxPerRun:4,maxFutureSkewMs:5*60*1000,
  q:Object.freeze({
    boat:'__QID_BOAT__',sail:'__QID_SAIL__',
    captainCard:'__QID_CAPTAIN_CARD__',captainName:'__QID_CAPTAIN_NAME__',
    captainClub:'__QID_CAPTAIN_CLUB__',secondCard:'__QID_SECOND_CARD__',
    secondName:'__QID_SECOND_NAME__',secondClub:'__QID_SECOND_CLUB__',
    crewJson:'__QID_CREW_JSON__',pdfName:'__QID_PDF_NAME__',
    pdfCard:'__QID_PDF_CARD__',pdfClub:'__QID_PDF_CLUB__',
    pdfOrder:'__QID_PDF_ORDER__',preview:'__QID_PREVIEW__',
    wosr1:'__QID_WOSR1__',wosr2:'__QID_WOSR2__'
  })
});
function RHV5_WRITER_configReady_(){
  const C=RHVM_WRITER_CONF;
  const vals=[C.centralId,C.entriesTab,C.queueTab,C.formId,C.race];
  if(!vals.every(v=>String(v||'').trim()&&!String(v).includes('__'))) return false;
  const qids=Object.values(C.q);
  return /^\d{9,}$/.test(String(C.formId)) && qids.every(v=>/^\d+$/.test(String(v))) &&
    new Set(qids).size===qids.length &&
    /^https:\/\/eu-api\.jotform\.com$/.test(C.apiRoot);
}
function RHV5_WRITER_assertConfig_(){
  if(!RHV5_WRITER_configReady_())throw Error('V5_WRITER_CONFIG_INCOMPLETE_OR_QID_MAPPING_MISSING');
}
function RHV5_WRITER_assertWrite_(){
  RHV5_WRITER_assertConfig_();
  if(RHV5_WRITER_MODE.allowWrites!==true)
    throw Error('V5_WRITER_WRITE_DISABLED_CANDIDATE');
}
function RHV5_WRITER_assertTrigger_(){
  RHV5_WRITER_assertWrite_();
  if(RHV5_WRITER_MODE.allowTriggers!==true)
    throw Error('V5_WRITER_TRIGGER_DISABLED_CANDIDATE');
}
function RHV5_WRITER_PREFLIGHT_CONFIGURATION(){
  const C=RHVM_WRITER_CONF;
  const result={revision:RHVM_WRITER_REVISION,mode:'READ_ONLY',
    configurationReady:RHV5_WRITER_configReady_(),
    writesEnabled:RHV5_WRITER_MODE.allowWrites===true,
    triggersEnabled:RHV5_WRITER_MODE.allowTriggers===true,
    totalQids:Object.keys(C.q).length,
    requiresIsolatedIntegrationTest:true,jotformWrites:0,sheetWrites:0,triggersCreated:0};
  Logger.log('RHV5_WRITER_CONFIG_PREFLIGHT '+JSON.stringify(result));
  return result;
}
function RHVM_WRITER_PREFLIGHT(){
  RHV5_WRITER_assertConfig_();
  const rows=RHVM_WRITER_candidates_();
  const report={mode:'READ_ONLY',revision:RHVM_WRITER_REVISION,race:RHVM_WRITER_CONF.race,
    waitingForEio:rows.waiting.length,readyForJotform:rows.ready.filter(x=>!x.nameRepairOnly).length,
    nameRepairs:rows.ready.filter(x=>x.nameRepairOnly).length,
    unsupportedCrew:rows.unsupported.length,problems:rows.problems.slice(0,6),
    alreadySynced:rows.synced.length,
    ready:rows.problems.length===0,jotformWrites:0,triggersCreated:0};
  Logger.log('RHVM_WRITER_PREFLIGHT '+JSON.stringify(report));return report;
}
function RHVM_WRITER_ENABLE_5MIN(){
  RHV5_WRITER_assertTrigger_();
  const report=RHVM_WRITER_PREFLIGHT();
  if(!report.ready)throw Error('V5_WRITER_PREFLIGHT_ERRORS_NO_TRIGGER');
  const name=RHVM_WRITER_CONF.handler;
  if(ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===name)){
    Logger.log('RHV5_WRITER_ALREADY_SCHEDULED');return;
  }
  // Never remove pre-existing triggers on another Writer in this candidate.
  ScriptApp.newTrigger(name).timeBased().everyMinutes(5).create();
  Logger.log('RHV5_WRITER_ENABLED_5MIN');
}
function RHVM_WRITER_DISABLE(){
  let count=0;
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===RHVM_WRITER_CONF.handler)
    .forEach(t=>{ScriptApp.deleteTrigger(t);count++;});
  Logger.log('RHVM_WRITER_DISABLED removed='+count);
}
function RHVM_WRITER_TICK(){
  RHV5_WRITER_assertWrite_();
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(10000)){Logger.log('RHVM_WRITER_BUSY');return;}
  try{
    const candidateSet=RHVM_WRITER_candidates_();
    let written=0,errors=0;
    for(const item of candidateSet.ready.slice(0,RHVM_WRITER_CONF.maxPerRun)){
      try{
        // Always REFRESH central proof and form immediately before a Jotform write.
        const fresh=RHVM_WRITER_candidates_().ready.find(x=>x.id===item.id);
        if(!fresh)continue;
        const outcome=RHVM_WRITER_updateOne_(fresh);
        if(outcome)written++;
      }catch(e){errors++;Logger.log('RHVM_WRITER_SKIPPED '+item.id+' '+String(e.message||e).slice(0,145));}
    }
    Logger.log('RHVM_WRITER_TICK '+JSON.stringify({race:RHVM_WRITER_CONF.race,
      selected:candidateSet.ready.length,written,errors,waitingForEio:candidateSet.waiting.length,
      unsupportedCrew:candidateSet.unsupported.length,blocked:candidateSet.problems.length,
      problems:candidateSet.problems.slice(0,6)}));
  }finally{lock.releaseLock();}
}
function RHVM_WRITER_candidates_(){
  RHV5_WRITER_assertConfig_();
  const C=RHVM_WRITER_CONF;const book=SpreadsheetApp.openById(C.centralId);
  const ent=book.getSheetByName(C.entriesTab),queue=book.getSheetByName(C.queueTab);
  if(!ent||!queue)throw Error('CENTRAL_TABS_MISSING');
  const er=ent.getDataRange().getDisplayValues(),qr=queue.getDataRange().getDisplayValues();
  const E=RHVM_WRITER_headers_(er[0],['submission_id','yacht_name','sail_number','cards_raw',
    'check_status','total_cards','checked_cards','jotform_sync','form_id','race_prefix','results_json']);
  const Q=RHVM_WRITER_headers_(qr[0],['task_id','submission_id','card','queue_status',
    'athlete_name','athlete_club','eio_status','source_page','result_json']);
  const ready=[],waiting=[],unsupported=[],problems=[],synced=[];
  const all=er.slice(1).map((r,i)=>({r,rowNo:i+2})).filter(x=>x.r[E.race_prefix]===C.race);
  const duplicates={};all.forEach(x=>{duplicates[x.r[E.submission_id]]=(duplicates[x.r[E.submission_id]]||0)+1;});
  for(const {r,rowNo} of all){
    const id=String(r[E.submission_id]||'').trim();
    try{
      if(!/^\d{10,22}$/.test(id)||duplicates[id]!==1)throw Error('INVALID_OR_DUPLICATE_ID');
      if(r[E.form_id]!==C.formId)throw Error('WRONG_FORM_FOR_RACE');
      const syncState=String(r[E.jotform_sync]||'').trim();
      if(!['',RHVM_WRITER_PENDING_SYNC,RHVM_WRITER_APPROVED_SYNC,RHVM_WRITER_INVALID_SYNC]
        .includes(syncState))throw Error('UNRECOGNIZED_SYNC_STATE');
      const published=(syncState===RHVM_WRITER_APPROVED_SYNC && r[E.check_status]==='Ελέγχθηκε') ||
        (syncState===RHVM_WRITER_INVALID_SYNC && r[E.check_status]==='Χρειάζεται επανέλεγχο');
      const nameRepairOnly=published && RHVM_WRITER_needsNameRepair_(r[E.results_json]);
      // Normal historical entries remain untouched. Name repairs require the
      // published proof to match the entire current crew below.
      if(syncState===RHVM_WRITER_APPROVED_SYNC && r[E.check_status]==='Ελέγχθηκε' && !nameRepairOnly){
        synced.push(id);continue;
      }
      const cards=String(r[E.cards_raw]||'').trim().split(/\s+/).map(RHVM_WRITER_digits_);
      if(cards.length<2||cards.length>15||new Set(cards).size!==cards.length||!cards.every(Boolean)){
        unsupported.push(id);continue;
      }
      const related=qr.slice(1).filter(q=>q[Q.submission_id]===id);
      if(related.length!==cards.length)throw Error('CENTRAL_QUEUE_COUNT_MISMATCH');
      if(!RHVM_WRITER_ALLOWED_CHECKS.includes(r[E.check_status]) ||
         Number(r[E.checked_cards])!==cards.length||Number(r[E.total_cards])!==cards.length){
        waiting.push(id);continue;
      }
      const people=[];
      for(const card of cards){
        const matched=related.filter(q=>q[Q.card]===card&&q[Q.task_id]==='Q-'+id+'-'+card);
        if(matched.length!==1)throw Error('MISSING_OR_DUPLICATE_EIO_CARD_'+card);
        const q=matched[0], name=String(q[Q.athlete_name]||'').trim(),
          club=String(q[Q.athlete_club]||'').trim(),
          status=String(q[Q.eio_status]||'').trim();
        if(!name||!club||!RHVM_WRITER_ALLOWED_STATES.includes(status))
          throw Error('EIO_NOT_IDENTIFIED_OR_UNSUPPORTED_STATUS_'+card);
        const expectedQueueState=status==='Active'?'Ελέγχθηκε':'Χρειάζεται επανέλεγχο';
        if(q[Q.queue_status]!==expectedQueueState)
          throw Error('EIO_QUEUE_STATUS_CONFLICT_'+card);
        if(!/^https:\/\/(?:www\.)?eio\.gr\/clubs\/get_player\.php(?:[?#]|$)/i.test(q[Q.source_page]))
          throw Error('INVALID_EIO_SOURCE_'+card);
        let proof;try{proof=JSON.parse(q[Q.result_json]);}catch(_){throw Error('BAD_EIO_JSON_'+card);}
        if(proof.card!==card||proof.name!==name||proof.club!==club||
          proof.status!==status||proof.source!=='EIO'||proof.searchComplete!==true||
          proof.notFound!==false)throw Error('EIO_PROOF_MISMATCH_'+card);
        people.push({card,name:RH_EIO_legacyName(name),rawName:name,club,status,observedAt:proof.observedAt});
      }
      const allActive=people.every(p=>p.status==='Active');
      if(allActive !== (r[E.check_status]==='Ελέγχθηκε'))
        throw Error('CENTRAL_AGGREGATE_STATUS_CONFLICT');
      // Invalid identities already copied to Jotform may be skipped on subsequent ticks.
      // A future EIO status/name change makes the stored result differ and enables re-sync.
      if(!nameRepairOnly && syncState===RHVM_WRITER_INVALID_SYNC && !allActive &&
         RHVM_WRITER_sameEvidence_(r[E.results_json],id,people)){
        synced.push(id);continue;
      }
      // Formatting a previously published identity does not assert a new EIO
      // check. Require the exact same published crew/status evidence; do not
      // replace eligibility, queue results, clubs, cards or observation times.
      if(nameRepairOnly && !RHVM_WRITER_samePublishedNames_(r[E.results_json],id,people,allActive))
        throw Error('NAME_REPAIR_PUBLISHED_EVIDENCE_CONFLICT');
      // Reuse the EIO result already verified for this submission/card above.
      // Its age must not force retained crew to be checked again or block a newly
      // added member. The Bridge owns additions; unchecked cards cannot reach here.
      // Keep the original observation time: a write is not a new EIO verification.
      for(const person of nameRepairOnly ? [] : people){
        const elapsed=Date.now()-Date.parse(person.observedAt||'');
        if(!Number.isFinite(elapsed)||elapsed < -C.maxFutureSkewMs)
          throw Error('EIO_PROOF_INVALID_TIME_'+person.card);
      }
      ready.push({id,boat:String(r[E.yacht_name]||'').trim(),sail:RHVM_WRITER_digits_(r[E.sail_number]),
        rowNo,people,allActive,nameRepairOnly,priorEvidence:String(r[E.results_json]||''),priorSync:syncState});
    }catch(e){problems.push({submissionId:id,error:String(e.message||e).slice(0,120)});}
  }
  ready.sort((a,b)=>Number(a.nameRepairOnly)-Number(b.nameRepairOnly));
  return {ready,waiting,unsupported,problems,synced};
}
function RHVM_WRITER_updateOne_(item,dryRun=false){
  if(!dryRun)RHV5_WRITER_assertWrite_();
  else RHV5_WRITER_assertConfig_();
  const C=RHVM_WRITER_CONF,q=C.q;
  const before=RHVM_WRITER_api_('get','/submission/'+item.id).content;
  if(String(before.id)!==item.id||String(before.form_id)!==C.formId)
    throw Error('JOTFORM_WRONG_SUBMISSION_OR_FORM');
  const A=before.answers||{};
  const fieldLabels={
    [q.boat]:'ΟΝΟΜΑ ΣΚΑΦΟΥΣ',[q.sail]:'ΑΡΙΘΜΟΣ ΠΑΝΙΟΥ',
    [q.captainCard]:'ΑΡΙΘΜΟΣ  ΑΘΛ. ΔΕΛΤΙΟΥ ΕΙΟ',
    [q.captainName]:'ΕΠΙΘΕΤΟ ΚΑΙ ΟΝΟΜΑ ΚΥΒΕΡΝΗΤΗ',
    [q.captainClub]:'ΟΜΙΛΟΣ ΚΥΒΕΡΝΗΤΗ',
    [q.secondCard]:'ΑΡ.ΔΕΤΛΥΙΟΥ ΔΕΥΤΕΡΟΥ ΚΥΒΕΡΝΗΤΗ',
    [q.secondName]:'ΔΕΥΤΕΡΟΣ ΚΥΒΕΡΝΗΤΗΣ ',
    [q.secondClub]:'ΟΜΙΛΟΣ ΔΕΥΤΕΡΟΥ ΚΥΒΕΡΝΗΤΗ ',
    [q.crewJson]:'CREW_JSON',[q.pdfName]:'CrewPDF_NAME',
    [q.pdfCard]:'CrewPDF_CARD',[q.pdfClub]:'CrewPDF_CLUB',
    [q.pdfOrder]:'CrewPDF_AA',[q.preview]:'Προεπισκόπηση Πληρώματος',
    [q.wosr1]:'Μέλος πληρώματος (1) εξοικειωμένο με τις διαδικασίες WS OSR 6.05.3:',
    [q.wosr2]:'Μέλος πληρώματος (2) εξοικειωμένο με τις διαδικασίες WS OSR 6.05.3:'};
  for(const [qid,label] of Object.entries(fieldLabels))
    if(RHVM_WRITER_normal_(A[qid]?.text)!==RHVM_WRITER_normal_(label))
      throw Error('JOTFORM_FIELD_CHANGED_QID_'+qid);
  const answer=id=>String(A[id]?.answer??'').trim();
  if(answer(q.boat)!==item.boat||RHVM_WRITER_digits_(answer(q.sail))!==item.sail||
    RHVM_WRITER_digits_(answer(q.captainCard))!==item.people[0].card)
    throw Error('JOTFORM_IDENTITY_MISMATCH');
  const secondCard=RHVM_WRITER_digits_(answer(q.secondCard));
  const captain=item.people[0];
  const secondCaptain=secondCard ? item.people[1] : null;
  if(secondCaptain && secondCaptain.card!==secondCard)
    throw Error('SECOND_CAPTAIN_CARD_ORDER_MISMATCH');
  const members=item.people.slice(secondCaptain?2:1);
  if(members.length<1 || item.people.length>15)throw Error('CREW_TOTAL_CARD_COUNT_OUT_OF_RANGE');
  let oldCrew;try{oldCrew=JSON.parse(answer(q.crewJson));}catch(_){throw Error('CREW_JSON_INVALID');}
  if(!Array.isArray(oldCrew)||oldCrew.length!==members.length)
    throw Error('JOTFORM_CREW_COUNT_CHANGED');
  const expectedCards=members.map(p=>p.card);
  const pdfCards=answer(q.pdfCard).split(/\r?\n/).map(RHVM_WRITER_digits_).filter(Boolean);
  const pdfOrder=answer(q.pdfOrder).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(JSON.stringify(pdfCards)!==JSON.stringify(expectedCards)||
     JSON.stringify(pdfOrder)!==JSON.stringify(members.map((_,i)=>String(i+1))))
    throw Error('JOTFORM_PDF_CARD_ORDER_CONFLICT');
  for(let i=0;i<members.length;i++){
    if(RHVM_WRITER_digits_(oldCrew[i]?.card)!==members[i].card)
      throw Error('JOTFORM_CREW_CARD_ORDER_CONFLICT');
    for(const [current,verified] of [
      [RH_EIO_legacyName(oldCrew[i]?.name),members[i].name],
      [String(oldCrew[i]?.club||'').trim(),members[i].club]
    ])if(current&&current!==verified)throw Error('EXISTING_CREW_DATA_CONFLICT_'+(i+1));
  }
  for(const [current,verified] of [
    [RH_EIO_legacyName(answer(q.captainName)),captain.name],[answer(q.captainClub),captain.club],
    ...(secondCaptain ? [[RH_EIO_legacyName(answer(q.secondName)),secondCaptain.name],
                        [answer(q.secondClub),secondCaptain.club]] : [])
  ])if(current&&current!==verified)throw Error('EXISTING_CAPTAIN_DATA_CONFLICT');
  const oldPreview=answer(q.preview);
  if(oldPreview&&!members.every(p=>oldPreview.includes(p.card)))
    throw Error('JOTFORM_PREVIEW_CARD_CONFLICT');
  // Crew changes may leave the NEW member's PDF name/club blank until EIO returns.
  // Preserve line positions: filtering out empty lines could shift athlete identities.
  // Never replace a non-empty conflicting value or silently accept extra lines.
  const priorLines=v=>{
    const raw=String(v||'').replace(/\r\n/g,'\n');
    return raw===''?[]:raw.split('\n').map(x=>x.trim());
  };
  const priorNames=priorLines(answer(q.pdfName));
  const priorClubs=priorLines(answer(q.pdfClub));
  const checkExistingLines=(lines,attribute,errorCode)=>{
    if(lines.length>members.length && lines.slice(members.length).some(Boolean))
      throw Error(errorCode+'_EXTRA_LINES');
    for(let i=0;i<Math.min(lines.length,members.length);i++){
      if(lines[i] && (attribute==='name'?RH_EIO_legacyName(lines[i]):lines[i])!==members[i][attribute])
        throw Error(errorCode+'_CARD_'+members[i].card);
    }
  };
  checkExistingLines(priorNames,'name','EXISTING_PDF_NAME_CONFLICT');
  checkExistingLines(priorClubs,'club','EXISTING_PDF_CLUB_CONFLICT');
  const preview='Α/Α            ΟΝΟΜΑΤΕΠΩΝΥΜΟ             ΑΡ. ΔΕΛΤΙΟ                 ΟΜΙΛΟΣ\n'+
    '─────────────────────────────────────────────────────────────────────────────────────────\n'+
    members.map((m,i)=>' '+(i+1)+'   '+m.name+'    '+m.card+'    '+m.club).join('\n');
  // For a published-name repair, all name fields must still identify the same
  // people. Do not fill missing identity data under a formatting-only operation.
  if(item.nameRepairOnly && (!answer(q.captainName) || (secondCaptain&&!answer(q.secondName)) ||
      priorNames.length!==members.length || priorNames.some(v=>!v) || oldCrew.some(v=>!String(v.name||'').trim())))
    throw Error('NAME_REPAIR_MISSING_PUBLISHED_NAME');
  const newCrew=oldCrew.map((v,i)=>item.nameRepairOnly?{...v,name:members[i].name}:
    {...v,name:members[i].name,card:members[i].card,club:members[i].club});
  const desired={
    [q.captainName]:captain.name,[q.captainClub]:captain.club,
    ...(secondCaptain ? {[q.secondName]:secondCaptain.name,[q.secondClub]:secondCaptain.club} : {}),
    [q.crewJson]:JSON.stringify(newCrew),
    [q.pdfName]:members.map(m=>m.name).join('\n'),
    [q.pdfClub]:members.map(m=>m.club).join('\n'),
    [q.preview]:preview
  };
  if(item.nameRepairOnly){
    delete desired[q.captainClub];delete desired[q.secondClub];delete desired[q.pdfClub];
    // Preserve existing preview layout/custom text; replace exact known names.
    let repairedPreview=oldPreview;
    const priorPersonNames=[answer(q.captainName),answer(q.secondName),...priorNames,
      ...oldCrew.map(v=>String(v.name||'')),...item.people.map(p=>p.rawName||'')];
    for(const oldName of priorPersonNames.filter(Boolean).sort((a,b)=>b.length-a.length)){
      const primary=RH_EIO_legacyName(oldName);
      if(oldName!==primary)repairedPreview=repairedPreview.split(oldName).join(primary);
    }
    desired[q.preview]=repairedPreview;
  }
  // Update only the specific WS OSR selected athlete when the form still has
  // the original pending-card placeholder; never overwrite custom text.
  const byCard=Object.fromEntries(item.people.map(x=>[x.card,x]));
  for(const id of [q.wosr1,q.wosr2]){
    const v=answer(id);
    const m=v.match(/^Αρ\. δελτίου\s+(\d+)\s+—\s+έλεγχος εκκρεμεί$/i);
    if(!item.nameRepairOnly && m && byCard[RHVM_WRITER_digits_(m[1])]) {
      const athlete=byCard[RHVM_WRITER_digits_(m[1])];
      desired[id]=athlete.status==='Active'?athlete.name:
        'Αρ. δελτίου '+athlete.card+' — ΜΗ ΕΓΚΥΡΟ ('+athlete.status+')';
    }
  }
  // Clean a WS OSR name only when its entire current value exactly matches a
  // known bilingual name from this crew. Never reinterpret free text or status.
  for(const id of [q.wosr1,q.wosr2]){
    const v=answer(id),matches=item.people.filter(p=>v===p.rawName && p.name!==p.rawName);
    if(matches.length===1)desired[id]=matches[0].name;
  }
  const diffs=Object.entries(desired).filter(([id,v])=>answer(id)!==v);
  if(dryRun)return {submissionId:item.id,boat:item.boat,nameRepairOnly:!!item.nameRepairOnly,
    changes:diffs.map(([id,value])=>({field:id,before:answer(id),after:value})),jotformWrites:0};
  if(diffs.length){
    const body=Object.entries(desired).map(([id,v])=>
      encodeURIComponent('submission['+id+']')+'='+encodeURIComponent(v)).join('&');
    RHVM_WRITER_api_('post','/submission/'+item.id,body);
  }
  const after=RHVM_WRITER_api_('get','/submission/'+item.id).content;
  if(String(after.id)!==item.id||String(after.form_id)!==C.formId)
    throw Error('POST_READBACK_WRONG_ID');
  for(const [id,expected] of Object.entries(desired))
    if(String(after.answers?.[id]?.answer??'').trim()!==expected.trim())
      throw Error('JOTFORM_READBACK_FAILED_QID_'+id);
  // Mark this very submission synced AFTER checking the updated Jotform.
  const ent=SpreadsheetApp.openById(C.centralId).getSheetByName(C.entriesTab);
  const rows=ent.getDataRange().getDisplayValues();
  const H=RHVM_WRITER_headers_(rows[0],['submission_id','form_id','race_prefix','jotform_sync','results_json']);
  const hits=rows.slice(1).map((r,i)=>({r,rowNo:i+2})).filter(x=>x.r[H.submission_id]===item.id);
  if(hits.length!==1||hits[0].r[H.form_id]!==C.formId||hits[0].r[H.race_prefix]!==C.race)
    throw Error('CENTRAL_IDENTITY_CHANGED_AFTER_WRITE');
  if(item.nameRepairOnly){
    if(String(hits[0].r[H.results_json]||'')!==item.priorEvidence || hits[0].r[H.jotform_sync]!==item.priorSync)
      throw Error('CENTRAL_NAME_REPAIR_CHANGED_AFTER_WRITE');
    const prior=JSON.parse(item.priorEvidence);
    prior.crew=prior.crew.map((person,i)=>({...person,name:item.people[i].name}));
    // Keep prior status, eligibility, sync-state and all other evidence fields.
    ent.getRange(hits[0].rowNo,H.results_json+1).setValue(JSON.stringify(prior));
    Logger.log('RHVM_WRITER_NAMES_REPAIRED '+JSON.stringify({submissionId:item.id,fieldsUpdated:diffs.length}));
    return true;
  }
  const result={schema:'regattahub.eio.v1',race:C.race,formId:C.formId,
    submissionId:item.id,status:item.allActive?'Ελέγχθηκε':'Χρειάζεται επανέλεγχο',
    eligibility:item.allActive?'APPROVED':'NOT_APPROVED',
    crew:item.people.map(p=>({card:p.card,name:p.name,club:p.club,status:p.status}))};
  // Jotform readback succeeded: save evidence and sync-state only, never alter check_status.
  ent.getRange(hits[0].rowNo,H.results_json+1).setValue(JSON.stringify(result));
  ent.getRange(hits[0].rowNo,H.jotform_sync+1)
    .setValue(item.allActive?RHVM_WRITER_APPROVED_SYNC:RHVM_WRITER_INVALID_SYNC);
  Logger.log('RHVM_WRITER_SYNCED '+JSON.stringify({submissionId:item.id,fieldsUpdated:diffs.length,
    eligibility:result.eligibility}));
  return true;
}
function RHVM_WRITER_sameEvidence_(stored,id,people){
  let previous;try{previous=JSON.parse(String(stored||''));}catch(_){return false;}
  if(previous.submissionId!==id || previous.eligibility!=='NOT_APPROVED' ||
     !Array.isArray(previous.crew)||previous.crew.length!==people.length)return false;
  return people.every((p,i)=>{
    const old=previous.crew[i];return old&&old.card===p.card&&RH_EIO_legacyName(old.name)===p.name&&
      old.club===p.club&&old.status===p.status;
  });
}
function RHVM_WRITER_headers_(h,keys){
  const map={};(h||[]).forEach((v,i)=>{map[String(v||'').trim()]=i;});
  keys.forEach(k=>{if(!Number.isInteger(map[k]))throw Error('HEADER_NOT_FOUND_'+k);});return map;
}
function RHVM_WRITER_api_(method,path,payload){
  RHV5_WRITER_assertConfig_();
  if(String(method).toLowerCase()!=='get')RHV5_WRITER_assertWrite_();
  const C=RHVM_WRITER_CONF,key=PropertiesService.getScriptProperties().getProperty(C.apiKeyProp);
  if(!key||!key.trim())throw Error('PRIVATE_JOTFORM_KEY_MISSING');
  const opts={method,headers:{APIKEY:key.trim()},followRedirects:false,muteHttpExceptions:true};
  if(payload!==undefined){opts.payload=payload;opts.contentType='application/x-www-form-urlencoded; charset=UTF-8';}
  const res=UrlFetchApp.fetch(C.apiRoot+path,opts);
  if(res.getResponseCode()!==200)throw Error('JOTFORM_HTTP_'+res.getResponseCode());
  let out;try{out=JSON.parse(res.getContentText());}catch(_){throw Error('JOTFORM_RESPONSE_NOT_JSON');}
  if(Number(out.responseCode)!==200||!out.content)throw Error('BAD_JOTFORM_RESPONSE');
  return out;
}
function RHVM_WRITER_digits_(v){return String(v||'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');}
function RHVM_WRITER_normal_(v){return String(v||'').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase();}

/* EIO name formatting only. No card, club, status or network operations. */
function RH_EIO_legacyName(value) {
  const text = String(value == null ? '' : value).normalize('NFC').replace(/\s+/g, ' ').trim();
  // Older table captures joined each Greek field directly to its Latin copy.
  // A separate Latin word can be a real foreign given name: preserve it.
  return text.split(' ').map(part => {
    if (!/\p{Script=Greek}/u.test(part) || !/\p{Script=Latin}/u.test(part)) return part;
    const match = /^([\p{Script=Greek}\p{M}]+(?:[-‐‑–'’ʼ\/][\p{Script=Greek}\p{M}]+)*)([\p{Script=Latin}\p{M}]+(?:[-‐‑–'’ʼ\/][\p{Script=Latin}\p{M}]+)*)$/u.exec(part);
    if (!match || (match[1].match(/\p{Script=Greek}/gu) || []).length < 2 ||
        (match[2].match(/\p{Script=Latin}/gu) || []).length < 2) {
      throw Error('AMBIGUOUS_MIXED_EIO_NAME');
    }
    return match[1];
  }).join(' ');
}

function RH_EIO_primaryField(value) {
  const text = String(value == null ? '' : value).normalize('NFC').replace(/\s+/g, ' ').trim();
  // This receives ONE surname/given-name field, never a combined full name.
  if (!/\p{Script=Greek}/u.test(text) || !/\p{Script=Latin}/u.test(text)) return text;
  // Reject letters interleaved inside a name, rather than guessing a spelling.
  // Parentheses/slashes separating an explicitly bilingual field are harmless.
  for (const part of text.replace(/[()/]/g, ' ').split(/\s+/)) {
    if (/\p{Script=Greek}/u.test(part) && /\p{Script=Latin}/u.test(part)) RH_EIO_legacyName(part);
  }
  const greek = text.match(/[\p{Script=Greek}\p{M}]+(?:[\s\-‐‑–'’ʼ\/]+[\p{Script=Greek}\p{M}]+)*/gu);
  return greek ? greek.join(' ').replace(/\s+/g, ' ').trim() : '';
}

function RHVM_WRITER_needsNameRepair_(stored){
  let prior;try{prior=JSON.parse(String(stored||''));}catch(_){return false;}
  if(!Array.isArray(prior.crew))return false;
  return prior.crew.some(p=>String(p.name||'').trim()!==RH_EIO_legacyName(p.name));
}
function RHVM_WRITER_samePublishedNames_(stored,id,people,allActive){
  let prior;try{prior=JSON.parse(String(stored||''));}catch(_){return false;}
  const C=RHVM_WRITER_CONF;
  if(prior.schema!=='regattahub.eio.v1'||prior.race!==C.race||prior.formId!==C.formId||
    prior.submissionId!==id||prior.status!==(allActive?'Ελέγχθηκε':'Χρειάζεται επανέλεγχο')||
    prior.eligibility!==(allActive?'APPROVED':'NOT_APPROVED')||
    !Array.isArray(prior.crew)||prior.crew.length!==people.length)return false;
  return people.every((p,i)=>{
    const old=prior.crew[i];return old&&old.card===p.card&&old.club===p.club&&old.status===p.status&&
      RH_EIO_legacyName(old.name)===p.name;
  });
}
function RHVM_WRITER_NAMES_PREFLIGHT(){
  RHV5_WRITER_assertConfig_();
  const rows=RHVM_WRITER_candidates_();
  const report={mode:'READ_ONLY',revision:RHVM_WRITER_REVISION,waitingForEio:rows.waiting.length,
    alreadySynced:rows.synced.length,problems:rows.problems.slice(),candidates:[],
    jotformWrites:0,sheetWrites:0,triggersCreated:0};
  for(const item of rows.ready){
    try{report.candidates.push(RHVM_WRITER_updateOne_(item,true));}
    catch(e){report.problems.push({submissionId:item.id,boat:item.boat,error:String(e.message||e)});}
  }
  Logger.log('RHVM_WRITER_NAMES_PREFLIGHT '+JSON.stringify(report));return report;
}
