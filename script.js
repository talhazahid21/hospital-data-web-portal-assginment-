const TYPES = {
  hospital:{label:'Hospitals',color:'#c0392b',filter:'["amenity"="hospital"]'},
  clinic:{label:'Clinics',color:'#1f7a8c',filter:'["amenity"="clinic"]'},
  pharmacy:{label:'Pharmacies',color:'#2e8b57',filter:'["amenity"="pharmacy"]'},
  doctors:{label:'Doctors',color:'#7b5ea7',filter:'["amenity"="doctors"]'},
  dentist:{label:'Dentists',color:'#d98e04',filter:'["amenity"="dentist"]'}
};
const BBOX = { isb:[33.40,72.80,33.85,73.35], rwp:[33.48,72.93,33.72,73.15] };
const ENDPOINTS = ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];

const map = L.map('map').setView([33.66,73.04],11);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
const layer = L.layerGroup().addTo(map);

const $ = id => document.getElementById(id);
let data = [], markers = new Map();

// filter checkboxes
$('types').innerHTML = Object.entries(TYPES).map(([k,t]) =>
  `<label><input type="checkbox" value="${k}" ${k==='pharmacy'||k==='doctors'||k==='dentist'?'':'checked'}><span class="dot" style="background:${t.color}"></span>${t.label}</label>`).join('');
const selectedTypes = () => [...document.querySelectorAll('#types input:checked')].map(i=>i.value);

const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setStatus(msg,err){ const s=$('status'); s.textContent=msg; s.className=err?'err':''; }

function buildQuery(city,types){
  const boxes = city==='both' ? [BBOX.isb,BBOX.rwp] : [BBOX[city]];
  let body='';
  for(const b of boxes) for(const t of types) body += `nwr${TYPES[t].filter}(${b.join(',')});`;
  return `[out:json][timeout:40];(${body});out center tags;`;
}

async function fetchOverpass(query){
  let lastErr;
  for(const url of ENDPOINTS){
    try{
      const r = await fetch(url,{method:'POST',body:'data='+encodeURIComponent(query),headers:{'Content-Type':'application/x-www-form-urlencoded'}});
      if(!r.ok) throw new Error('Server returned '+r.status);
      return await r.json();
    }catch(e){ lastErr=e; }
  }
  throw lastErr;
}

function normalise(json){
  const seen = new Set(), out=[];
  for(const e of json.elements){
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if(lat==null||lon==null) continue;
    const key = e.type+e.id; if(seen.has(key)) continue; seen.add(key);
    const t = e.tags||{};
    const type = ['hospital','clinic','pharmacy','doctors','dentist'].find(x=>t.amenity===x);
    if(!type) continue;
    const addr = [t['addr:housenumber'],t['addr:street'],t['addr:suburb']||t['addr:city']].filter(Boolean).join(', ');
    out.push({id:key,lat,lon,type,name:t.name||t['name:en']||('Unnamed '+type),
      phone:t.phone||t['contact:phone']||'',hours:t.opening_hours||'',addr,
      emergency:t.emergency||'',beds:t.beds||'',speciality:t['healthcare:speciality']||'',
      operator:t.operator||'',website:t.website||t['contact:website']||''});
  }
  return out;
}

function icon(color){
  return L.divIcon({className:'',html:`<span style="display:block;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4)"></span>`,iconSize:[14,14],iconAnchor:[7,7],popupAnchor:[0,-8]});
}

function popupHtml(f){
  const rows = [['Type',TYPES[f.type].label.replace(/s$/,'')],['Address',f.addr],['Phone',f.phone],['Hours',f.hours],
    ['Emergency',f.emergency],['Beds',f.beds],['Speciality',f.speciality],['Operator',f.operator]]
    .filter(r=>r[1]).map(r=>`<tr><td>${r[0]}</td><td>${esc(r[1])}</td></tr>`).join('');
  const web = f.website && /^https?:\/\//.test(f.website) ? `<p><a href="${esc(f.website)}" target="_blank" rel="noopener">Website</a></p>` : '';
  return `<div class="pop"><b>${esc(f.name)}</b><table>${rows}</table>${web}</div>`;
}

function render(){
  layer.clearLayers(); markers.clear();
  const q = $('q').value.trim().toLowerCase();
  const types = selectedTypes();
  const shown = data.filter(f=>types.includes(f.type) && (!q || f.name.toLowerCase().includes(q)));
  shown.forEach(f=>{
    const m = L.marker([f.lat,f.lon],{icon:icon(TYPES[f.type].color),title:f.name}).bindPopup(popupHtml(f)).addTo(layer);
    markers.set(f.id,m);
  });
  $('list').innerHTML = shown.length ? shown.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(f=>
    `<li tabindex="0" data-id="${f.id}"><b>${esc(f.name)}</b><span>${TYPES[f.type].label.replace(/s$/,'')}${f.addr?' · '+esc(f.addr):''}</span></li>`).join('')
    : '<li style="cursor:default">No facilities match. Try another type or clear the search.</li>';
  const counts = Object.keys(TYPES).map(k=>[k,shown.filter(f=>f.type===k).length]).filter(c=>c[1]);
  $('stats').innerHTML = `<span class="chip"><b>${shown.length}</b> shown</span>` + counts.map(([k,n])=>`<span class="chip"><span class="dot" style="background:${TYPES[k].color}"></span>${n} ${TYPES[k].label.toLowerCase()}</span>`).join('');
  if(shown.length) map.fitBounds(L.latLngBounds(shown.map(f=>[f.lat,f.lon])).pad(0.1));
}

async function load(){
  const types = selectedTypes();
  if(!types.length){ setStatus('Select at least one facility type.',true); return; }
  $('load').disabled = true; setStatus('Fetching data from Overpass API…');
  try{
    const json = await fetchOverpass(buildQuery($('city').value,types));
    data = normalise(json);
    setStatus(`Loaded ${data.length} facilities. Click a marker or list item for details.`);
    render();
  }catch(e){
    setStatus('Could not reach the Overpass API ('+e.message+'). Check your internet connection and try again.',true);
  }finally{ $('load').disabled=false; }
}

function focusItem(li){
  const m = markers.get(li.dataset.id); if(!m) return;
  map.setView(m.getLatLng(),16); m.openPopup();
}
$('list').addEventListener('click',e=>{const li=e.target.closest('li[data-id]'); if(li) focusItem(li);});
$('list').addEventListener('keydown',e=>{if(e.key==='Enter'){const li=e.target.closest('li[data-id]'); if(li) focusItem(li);}});
$('load').addEventListener('click',load);
$('q').addEventListener('input',render);
$('types').addEventListener('change',()=>{ const need = selectedTypes().some(t=>!data.some(f=>f.type===t)); need ? load() : render(); });
$('city').addEventListener('change',load);
$('csv').addEventListener('click',()=>{
  if(!data.length){ setStatus('Nothing to export yet. Fetch data first.',true); return; }
  const cols=['name','type','lat','lon','addr','phone','hours','emergency','beds','speciality','operator','website'];
  const csv=[cols.join(',')].concat(data.map(f=>cols.map(c=>`"${String(f[c]??'').replace(/"/g,'""')}"`).join(','))).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='twin_cities_healthcare.csv'; a.click();
});
load();
