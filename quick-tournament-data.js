/* ARROWS ESPORTS — Quick Tournament data + knockout helpers
   Cloud source: public.quick_tournament_state (single row id='main').
   Falls back to localStorage so the pages remain usable before the SQL migration is run. */
(function(){
  const STORAGE_KEY="arrowsQuickTournament";
  const TABLE="quick_tournament_state";
  const ROW_ID="main";
  const cfg=window.ARROWS_SUPABASE||{};
  const BASE=String(cfg.url||"").replace(/\/$/,"");
  const KEY=String(cfg.publishableKey||"");
  const headers=KEY?{apikey:KEY,Authorization:"Bearer "+KEY,"Content-Type":"application/json"}:{};

  const clone=value=>JSON.parse(JSON.stringify(value));
  const uid=()=>{
    if(window.crypto&&crypto.randomUUID) return crypto.randomUUID();
    return "q_"+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
  };

  function defaultState(){
    return {
      version:1,
      title:"ARROWS QUICK TOURNAMENT",
      size:8,
      status:"upcoming",
      players:[],
      fixtures:[],
      updatedAt:new Date().toISOString()
    };
  }

  const ROUND_META={
    r16:{key:"r16",label:"Round of 16",short:"R16",order:1},
    qf:{key:"qf",label:"Quarter Finals",short:"QF",order:2},
    sf:{key:"sf",label:"Semi Finals",short:"SF",order:3},
    f:{key:"f",label:"Final",short:"F",order:4}
  };

  function validSize(value){
    const n=Number(value);
    return [4,8,16].includes(n)?n:8;
  }

  function normalizeSource(source){
    if(!source||typeof source!=="object") return null;
    if(source.type==="player"&&source.id) return {type:"player",id:String(source.id)};
    if(source.type==="winner"&&source.matchId) return {type:"winner",matchId:String(source.matchId)};
    return null;
  }

  function normalizeState(raw){
    const base=defaultState();
    const s=(raw&&typeof raw==="object")?raw:{};
    base.version=1;
    base.title=String(s.title||base.title).trim()||base.title;
    base.size=validSize(s.size);
    base.status=["upcoming","active","completed"].includes(s.status)?s.status:"upcoming";
    base.players=Array.isArray(s.players)?s.players.map((p,i)=>({
      id:String(p&&p.id||uid()),
      name:String(p&&p.name||`Player ${i+1}`).trim()||`Player ${i+1}`
    })).slice(0,16):[];
    base.fixtures=Array.isArray(s.fixtures)?s.fixtures.map((m,i)=>{
      const roundKey=ROUND_META[m&&m.roundKey]?m.roundKey:(String(m&&m.round||"").toLowerCase().includes("16")?"r16":String(m&&m.round||"").toLowerCase().includes("quarter")?"qf":String(m&&m.round||"").toLowerCase().includes("semi")?"sf":"f");
      const meta=ROUND_META[roundKey]||ROUND_META.f;
      return {
        id:String(m&&m.id||uid()),
        roundKey:meta.key,
        roundLabel:String(m&&m.roundLabel||meta.label),
        order:Number(m&&m.order)||i+1,
        generated:m&&m.generated===false?false:true,
        homeSource:normalizeSource(m&&m.homeSource),
        awaySource:normalizeSource(m&&m.awaySource),
        homeScore:(m&&m.homeScore!==null&&m&&m.homeScore!==""&&Number.isFinite(Number(m.homeScore)))?Number(m.homeScore):null,
        awayScore:(m&&m.awayScore!==null&&m&&m.awayScore!==""&&Number.isFinite(Number(m.awayScore)))?Number(m.awayScore):null,
        winnerId:m&&m.winnerId?String(m.winnerId):null,
        status:m&&m.status==="completed"?"completed":"scheduled",
        date:String(m&&m.date||""),
        time:String(m&&m.time||""),
        note:String(m&&m.note||"")
      };
    }):[];
    base.updatedAt=String(s.updatedAt||base.updatedAt);
    return base;
  }

  function shuffle(list){
    const a=list.slice();
    for(let i=a.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  function roundsForSize(size){
    size=validSize(size);
    if(size===16) return [ROUND_META.r16,ROUND_META.qf,ROUND_META.sf,ROUND_META.f];
    if(size===8) return [ROUND_META.qf,ROUND_META.sf,ROUND_META.f];
    return [ROUND_META.sf,ROUND_META.f];
  }

  function generateBracket(state,randomize){
    const s=normalizeState(state);
    const size=validSize(s.size);
    if(s.players.length!==size){
      throw new Error(`Add exactly ${size} players before generating the bracket.`);
    }
    const players=randomize?shuffle(s.players):s.players.slice();
    const rounds=roundsForSize(size);
    const fixtures=[];
    let previous=[];

    rounds.forEach((round,ri)=>{
      const matchCount=size/Math.pow(2,ri+1);
      const current=[];
      for(let i=0;i<matchCount;i++){
        const id=uid();
        let homeSource=null,awaySource=null;
        if(ri===0){
          homeSource={type:"player",id:players[i*2].id};
          awaySource={type:"player",id:players[i*2+1].id};
        }else{
          homeSource={type:"winner",matchId:previous[i*2].id};
          awaySource={type:"winner",matchId:previous[i*2+1].id};
        }
        const match={
          id,roundKey:round.key,roundLabel:round.label,order:i+1,generated:true,
          homeSource,awaySource,homeScore:null,awayScore:null,winnerId:null,status:"scheduled",date:"",time:"",note:""
        };
        fixtures.push(match); current.push(match);
      }
      previous=current;
    });
    s.fixtures=fixtures;
    s.status="active";
    s.updatedAt=new Date().toISOString();
    return s;
  }

  function fixtureById(state,id){
    return (state.fixtures||[]).find(m=>String(m.id)===String(id))||null;
  }

  function playerById(state,id){
    return (state.players||[]).find(p=>String(p.id)===String(id))||null;
  }

  function resolveSource(state,source,seen){
    source=normalizeSource(source);
    if(!source) return {player:null,label:"TBD"};
    if(source.type==="player"){
      const p=playerById(state,source.id);
      return {player:p,label:p?p.name:"TBD"};
    }
    const match=fixtureById(state,source.matchId);
    if(!match) return {player:null,label:"Winner TBD"};
    const guard=seen||new Set();
    if(guard.has(match.id)) return {player:null,label:"TBD"};
    guard.add(match.id);
    if(match.winnerId){
      const p=playerById(state,match.winnerId);
      if(p) return {player:p,label:p.name};
    }
    return {player:null,label:`Winner • ${match.roundLabel} ${match.order}`};
  }

  function getParticipants(state,match){
    return {
      home:resolveSource(state,match.homeSource,new Set([match.id])),
      away:resolveSource(state,match.awaySource,new Set([match.id]))
    };
  }

  function sanitizeResults(state){
    const s=normalizeState(state);
    // Re-check winners against the currently resolved players. If an upstream winner
    // changes, invalid downstream results are cleared instead of showing impossible matches.
    const ordered=s.fixtures.slice().sort((a,b)=>{
      const ar=ROUND_META[a.roundKey]?.order||99, br=ROUND_META[b.roundKey]?.order||99;
      return ar-br || a.order-b.order;
    });
    ordered.forEach(match=>{
      const parts=getParticipants(s,match);
      const ids=[parts.home.player&&parts.home.player.id,parts.away.player&&parts.away.player.id].filter(Boolean).map(String);
      if(match.winnerId&&!ids.includes(String(match.winnerId))){
        match.winnerId=null;match.homeScore=null;match.awayScore=null;match.status="scheduled";
      }
      if(match.status==="completed"&&!match.winnerId) match.status="scheduled";
    });
    const final=ordered.find(m=>m.roundKey==="f"&&m.generated!==false);
    s.status=final&&final.status==="completed"&&final.winnerId?"completed":(s.fixtures.length?"active":s.status);
    return s;
  }

  function champion(state){
    const s=sanitizeResults(state);
    const final=s.fixtures.find(m=>m.roundKey==="f"&&m.generated!==false);
    return final&&final.winnerId?playerById(s,final.winnerId):null;
  }

  async function cloudRequest(path,opt={}){
    if(!BASE||!KEY) throw new Error("Supabase is not configured");
    const res=await fetch(BASE+"/rest/v1/"+path,{...opt,cache:"no-store",headers:{...headers,...(opt.headers||{})}});
    const text=await res.text();
    let data=null; try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok) throw new Error((data&&data.message)||text||`HTTP ${res.status}`);
    return data;
  }

  function saveLocal(state){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(e){}
  }
  function loadLocal(){
    try{return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)||"null"));}catch(e){return defaultState();}
  }

  async function load(){
    try{
      const rows=await cloudRequest(`${TABLE}?id=eq.${encodeURIComponent(ROW_ID)}&select=data,updated_at&limit=1`);
      if(rows&&rows.length&&rows[0].data){
        const s=normalizeState(rows[0].data);
        if(rows[0].updated_at) s.updatedAt=rows[0].updated_at;
        saveLocal(s);
        return {state:s,source:"cloud",warning:""};
      }
    }catch(error){
      const local=loadLocal();
      return {state:local,source:"local",warning:error.message||String(error)};
    }
    const local=loadLocal();
    return {state:local,source:"local",warning:"Quick tournament cloud row was not found."};
  }

  async function save(input){
    let state=sanitizeResults(input);
    state.updatedAt=new Date().toISOString();
    saveLocal(state);
    try{
      await cloudRequest(`${TABLE}?on_conflict=id`,{
        method:"POST",
        headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
        body:JSON.stringify({id:ROW_ID,data:state,updated_at:state.updatedAt})
      });
      return {state,source:"cloud",warning:""};
    }catch(error){
      return {state,source:"local",warning:error.message||String(error)};
    }
  }

  window.ARROWS_QUICK={
    defaultState,normalizeState,validSize,roundsForSize,generateBracket,sanitizeResults,
    playerById,fixtureById,resolveSource,getParticipants,champion,uid,load,save,
    roundMeta:ROUND_META,storageKey:STORAGE_KEY
  };
})();
