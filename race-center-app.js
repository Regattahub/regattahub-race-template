"use strict";
const sections=[
 {key:"entries",title:"Πίνακας συμμετοχών",description:"Συμμετοχές σκαφών και έλεγχος δελτίων.",icon:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/>',featured:true},
 {key:"crews",title:"Πληρώματα ανά σκάφος",description:"Καταστάσεις πληρωμάτων ανά σκάφος.",icon:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0112 0v2M16 5a3 3 0 010 6M19 20v-2a6 6 0 00-2-4"/>',featured:true},
 {key:"results",title:"Αποτελέσματα",description:"Κατατάξεις και αποτελέσματα ιστιοδρομιών.",icon:'<path d="M8 3h8v6a4 4 0 01-8 0V3ZM8 5H4v3a4 4 0 004 4M16 5h4v3a4 4 0 01-4 4M12 13v7M8 21h8"/>'},
 {key:"notice",title:"Προκήρυξη",description:"Η προκήρυξη και οι όροι του αγώνα.",icon:'<path d="M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h6"/>'},
 {key:"entryForm",title:"Δήλωση συμμετοχής",description:"Η φόρμα εγγραφής στον αγώνα.",icon:'<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 4V2h6v2M8 10h8M8 14h8M8 18h4"/>'},
 {key:"website",title:"Website αγώνα",description:"Ανακοινώσεις και πληροφορίες διοργανωτή.",icon:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 010 18 18 18 0 010-18Z"/>'},
 {key:"photos",title:"Φωτογραφίες & Video",description:"Το φωτογραφικό υλικό και τα video του αγώνα.",icon:'<path d="M8 5l2-2h4l2 2h5v15H3V5h5Z"/><circle cx="12" cy="12" r="4"/>'}
];
let config={raceTitle:"Κέντρο Αγώνα",raceDate:"",organizer:"",organizerLogoUrl:"",organizerBannerUrl:"",links:{}};
let sheetState="loading";
let previewApplied=false;
const $=id=>document.getElementById(id);
function validUrl(value){try{const u=new URL(value);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}}
function render(){
 $("race-title").textContent=config.raceTitle;$("race-date").textContent=config.raceDate;$("organizer").textContent=config.organizer;
 const logo=$("organizer-logo"),wrap=$("organizer-logo-wrap");
 const logoUrl=config.organizerLogoUrl||"";wrap.hidden=true;
 logo.onload=()=>{wrap.hidden=false;};logo.onerror=()=>{wrap.hidden=true;};
 if(validUrl(logoUrl)){logo.alt=`Σήμα διοργανωτή: ${config.organizer}`;if(logo.getAttribute("src")!==logoUrl)logo.src=logoUrl;else if(logo.complete&&logo.naturalWidth>0)wrap.hidden=false;}else logo.removeAttribute("src");
 const banner=$("organizer-banner"),bannerWrap=$("organizer-banner-wrap");
 bannerWrap.hidden=true;
 banner.onload=()=>{bannerWrap.hidden=false;};banner.onerror=()=>{bannerWrap.hidden=true;};
 const bannerUrl=config.organizerBannerUrl||"";
 if(validUrl(bannerUrl)){if(banner.getAttribute("src")!==bannerUrl)banner.src=bannerUrl;else if(banner.complete&&banner.naturalWidth>0)bannerWrap.hidden=false;}else banner.removeAttribute("src");
 document.title=`${config.raceTitle} · RegattaHub`;
 $("cards").replaceChildren(...sections.map(s=>{
   const url=config.links[s.key];const connected=!!url&&validUrl(url);const el=document.createElement(connected?"a":"button");
   el.className="card";el.dataset.section=s.key;
   if(connected){el.href=url;el.target="_blank";el.rel="noopener noreferrer";el.setAttribute("aria-label",s.title+" — ανοίγει σε νέα καρτέλα");}else{el.type="button";el.addEventListener("click",()=>showDetail(s));}
   el.innerHTML=`<span class="card-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${s.icon}</svg></span><span class="card-title"></span>`;
   el.querySelector(".card-title").textContent=s.title;
   return el;
 }));
 const pending=sections.some(s=>!validUrl(config.links[s.key]||""));
 let note=sheetState==="loaded"?"Τα στοιχεία και ο πίνακας συμμετοχών φορτώθηκαν από τις ΡΥΘΜΙΣΕΙΣ του αγώνα. Οι αλλαγές στο Sheet εμφανίζονται με ανανέωση της σελίδας.":sheetState==="loading"?"Φόρτωση ρυθμίσεων από το Sheet αγώνα…":"Δεν ήταν δυνατή η ανάγνωση του αγώνα Sheet. Εμφανίζονται οι ρυθμίσεις αγώνα.";
 if(pending)note+=" Δεν έχουν οριστεί όλοι οι σύνδεσμοι.";
 if(previewApplied)note+=" Οι αλλαγές της προεπισκόπησης ισχύουν μόνο μέχρι την ανανέωση.";
 document.querySelector(".test-note p").textContent=note;
}
function showDetail(s){$("detail-title").textContent=s.title;$("detail-description").textContent=s.description;$("detail-dialog").showModal();}
function openSettings(){
 $("form-error").textContent="";
 const sheetLink=$("settings-sheet-link");sheetLink.hidden=!config.settingsSheetUrl;if(config.settingsSheetUrl)sheetLink.href=config.settingsSheetUrl;
 const form=$("settings-form");for(const key of ["raceTitle","raceDate","organizer","organizerLogoUrl"])form.elements[key].value=config[key]||"";
 $("link-fields").replaceChildren(...sections.map(s=>{const label=document.createElement("label");label.textContent=s.title;const input=document.createElement("input");input.type="url";input.name=s.key;input.value=config.links[s.key]||"";input.placeholder="https://…";input.autocomplete="off";label.append(input);return label;}));$("settings-dialog").showModal();
}
document.querySelectorAll(".close-button").forEach(b=>b.addEventListener("click",()=>b.closest("dialog").close()));
$("settings-open").addEventListener("click",openSettings);$("settings-cancel").addEventListener("click",()=>$("settings-dialog").close());
$("detail-settings").addEventListener("click",()=>{$("detail-dialog").close();openSettings();});
$("settings-form").addEventListener("submit",e=>{e.preventDefault();const data=new FormData(e.target);const links={};for(const s of sections){const url=String(data.get(s.key)||"").trim();if(url&&!validUrl(url)){$("form-error").textContent=`Ο σύνδεσμος «${s.title}» πρέπει να αρχίζει με https:// ή http:// και να μην περιλαμβάνει στοιχεία σύνδεσης.`;e.target.elements[s.key].focus();return;}links[s.key]=url;}const organizerLogoUrl=String(data.get("organizerLogoUrl")||"").trim();if(organizerLogoUrl&&!validUrl(organizerLogoUrl)){$("form-error").textContent="Συμπληρώστε έγκυρο σύνδεσμο εικόνας για το σήμα διοργανωτή.";e.target.elements.organizerLogoUrl.focus();return;}const title=String(data.get("raceTitle")).trim();if(!title){$("form-error").textContent="Συμπληρώστε τον τίτλο αγώνα.";return;}config={...config,raceTitle:title,raceDate:String(data.get("raceDate")).trim(),organizer:String(data.get("organizer")).trim(),organizerLogoUrl,links};previewApplied=true;render();$("settings-dialog").close();$("toast").textContent="Οι σύνδεσμοι εφαρμόστηκαν για αυτή την προβολή.";$("toast").hidden=false;setTimeout(()=>{$("toast").hidden=true;},4500);});
function checkedSettingsEndpoint(value){
 const u=new URL(value);
 if(u.protocol!=="https:"||u.hostname!=="script.google.com"||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname)||u.username||u.password||! /^[A-Za-z0-9_-]+$/.test(u.searchParams.get("settings")||"")||u.searchParams.get("action")!=="settings")throw new Error("invalid settings endpoint");
 return u;
}
function readSheetSettings(endpoint){
 return new Promise((resolve,reject)=>{
  let u;try{u=checkedSettingsEndpoint(endpoint);}catch(error){reject(error);return;}
  const name="raceCenterSettings_"+Date.now()+"_"+Math.random().toString(36).slice(2);
  const script=document.createElement("script");let settled=false;
  const finish=(error,data)=>{
   if(settled)return;settled=true;clearTimeout(timer);script.remove();
   // A delayed response can still execute after removal. Leave a harmless callback briefly.
   window[name]=()=>{};setTimeout(()=>{delete window[name];},30000);
   if(error)reject(error);else resolve(data);
  };
  const timer=setTimeout(()=>finish(new Error("settings timeout")),20000);
  window[name]=data=>finish(null,data);
  script.onerror=()=>finish(new Error("settings unavailable"));
  u.searchParams.set("callback",name);u.searchParams.set("_",String(Date.now()));
  script.src=u.toString();script.referrerPolicy="no-referrer";document.head.append(script);
 });
}
function mergeSheetSettings(base,data){
 if(!data||data.success!==true||typeof data.raceTitle!=="string"||!data.raceTitle.trim())throw new Error("invalid settings response");
 if(typeof data.viewer!=="string"||!validUrl(data.viewer)||new URL(data.viewer).searchParams.get("settings")!==checkedSettingsEndpoint(base.settingsEndpoint).searchParams.get("settings"))throw new Error("viewer settings mismatch");
 const next={...base,links:{...base.links,entries:data.viewer},raceTitle:data.raceTitle.trim()};
 if(typeof data.raceDate==="string")next.raceDate=data.raceDate;
 if(typeof data.organizerName==="string")next.organizer=data.organizerName;
 if(typeof data.organizerBanner==="string")next.organizerBannerUrl=validUrl(data.organizerBanner)?data.organizerBanner:"";
 if(typeof data.organizerLogoUrl==="string")next.organizerLogoUrl=validUrl(data.organizerLogoUrl)?data.organizerLogoUrl:"";
 // Optional fields for a later endpoint extension. Missing fields leave these cards unconfigured.
 for(const [key,field] of Object.entries({crews:"crewsUrl",results:"resultsUrl",notice:"noticeUrl",entryForm:"entryFormUrl",website:"websiteUrl",photos:"photosUrl"})){
  if(typeof data[field]==="string")next.links[key]=validUrl(data[field])?data[field]:"";
 }
 if(!next.links.entryForm&&/^\d{10,20}$/.test(data.jotformFormId||""))next.links.entryForm="https://form.jotform.com/"+data.jotformFormId;
 return next;
}
async function initialize(){
 $("settings-open").disabled=true;$("detail-settings").disabled=true;render();
 try{
  const response=await fetch("race-config.json",{cache:"no-store"});if(!response.ok)throw new Error("config");
  const c=await response.json();
  if(c.schemaVersion!==1||!["race","test"].includes(c.mode)||typeof c.raceTitle!=="string"||!c.raceTitle.trim())throw new Error("schema");
  checkedSettingsEndpoint(c.settingsEndpoint);
  config={...config,...c,links:{...c.links}};render();
  config=mergeSheetSettings(config,await readSheetSettings(c.settingsEndpoint));sheetState="loaded";
 }catch(error){sheetState="error";}
 finally{render();$("settings-open").disabled=false;$("detail-settings").disabled=false;}
}
initialize();
