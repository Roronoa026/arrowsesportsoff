/* ARROWS ESPORTS - Supabase bridge
   Keeps the existing local tournament UI working while synchronizing its data
   with the normalized Supabase tables already created by the project.
*/
(function(){
  if(!window.ARROWS_SUPABASE) return;
  const BASE=window.ARROWS_SUPABASE.url.replace(/\/$/,'');
  const KEY=window.ARROWS_SUPABASE.publishableKey;
  const H={apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',Prefer:'return=representation'};
  const LS='footballTournament', PLAYER_KEYS=['arrowsClanPlayers','players'];
  let syncing=false, timer=null, initial=true;
  const json=(v,d)=>{try{return JSON.parse(v)}catch(e){return d}};
  const esc=v=>encodeURIComponent(v);
  async function api(path,opts={}){
    const r=await fetch(BASE+'/rest/v1/'+path,{...opts,headers:{...H,...(opts.headers||{})}});
    const text=await r.text();
    let data=null; try{data=text?JSON.parse(text):null}catch(e){data=text}
    if(!r.ok) throw new Error((data&&data.message)||text||('HTTP '+r.status));
    return data;
  }
  const post=(table,body)=>api(table,{method:'POST',body:JSON.stringify(body)});
  const patch=(table,filter,body)=>api(table+'?'+filter,{method:'PATCH',body:JSON.stringify(body)});
  const del=(table,filter)=>api(table+'?'+filter,{method:'DELETE'});
  const get=(table,filter='')=>api(table+(filter?'?'+filter:''));
  const uuid=()=>crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3)|8;return v.toString(16)});
  const metaPrefix='ARROWS_META:';
  function readTournament(){return json(localStorage.getItem(LS),null)}
  function writeTournament(t){localStorage.setItem(LS,JSON.stringify(t))}
  function tournamentMeta(t){return {...t,teams:undefined,fixtures:undefined};}
  function teamMeta(team){return {clientId:String(team.id),players:undefined};}
  function matchMeta(m){return {...m};}
  async function findTournament(t){
    const clientId=String(t?._supabaseClientId||'');
    let rows=[];
    if(clientId) rows=await get('tournaments','description=ilike.'+esc(metaPrefix+'%'+clientId+'%')+'&select=*');
    if(!rows.length) rows=await get('tournaments','order=updated_at.desc&limit=1&select=*');
    return rows[0]||null;
  }
  function tournamentRow(t){
    const meta=tournamentMeta(t); delete meta._supabaseUpdatedAt;
    return {name:t.name||'ARROWS DUO TOURNAMENT',type:t.type||'roundrobin',description:metaPrefix+JSON.stringify(meta),logo:t.logo||null,banner:t.banner||null,start_date:t.startDate||t.start_date||null,end_date:t.endDate||t.end_date||null,status:t.status||'upcoming',entry_fee:Number(t.entryFee||t.entry_fee||0),prize_pool:Number(t.prizePool||t.prize_pool||0),max_teams:Number(t.maxTeams||t.max_teams||t.teams?.length||0)||null};
  }
  function parseDateTime(m){
    if(!m.date) return null;
    const v=m.date+(m.time?'T'+m.time:'T00:00');
    const d=new Date(v); return isNaN(d)?null:d.toISOString();
  }
  function score(m,teamId){return (m.goals||[]).filter(g=>String(g.teamId)===String(teamId)).length}
  async function syncTournament(t){
    if(!t||!Array.isArray(t.teams)) return;
    t._supabaseClientId=t._supabaseClientId||uuid();
    const row=await findTournament(t);
    let tournamentId=row?.id;
    if(!tournamentId){
      const created=await post('tournaments',tournamentRow(t));
      tournamentId=created?.[0]?.id;
      if(!tournamentId) throw new Error('Supabase did not return a tournament id');
    }else{
      await patch('tournaments','id=eq.'+esc(tournamentId),tournamentRow(t));
    }
    t._supabaseId=tournamentId;
    t._supabaseUpdatedAt=new Date().toISOString();

    // Rebuild the relation rows for the active tournament. Existing global teams/players are reused by name/username.
    await del('tournament_teams','tournament_id=eq.'+esc(tournamentId));
    await del('tournament_players','tournament_id=eq.'+esc(tournamentId));
    await del('matches','tournament_id=eq.'+esc(tournamentId));

    const teamIds={}; const playerIds={};
    for(const team of t.teams){
      const name=String(team.name||'Team').trim();
      let found=await get('teams','name=eq.'+esc(name)+'&select=*');
      let dbTeam=found[0];
      const teamBody={name,logo:team.logo||null,captain_name:team.captain_name||team.captainName||null,captain_phone:team.captain_phone||team.captainPhone||null,description:teamMeta(team)?metaPrefix+JSON.stringify(teamMeta(team)):null};
      if(dbTeam) await patch('teams','id=eq.'+esc(dbTeam.id),teamBody); else {const x=await post('teams',teamBody);dbTeam=x?.[0];}
      if(!dbTeam?.id) continue;
      teamIds[String(team.id)]=dbTeam.id;
      await post('tournament_teams',{tournament_id:tournamentId,team_id:dbTeam.id,played:0,won:0,drawn:0,lost:0,goals_for:0,goals_against:0,points:0});
      for(const p of (team.players||[])){
        const pname=String(p.name||'Player').trim();
        const username=p.efootballId||('ARROWS_LOCAL_'+String(p.id));
        let foundP=await get('players','username=eq.'+esc(username)+'&select=*');
        let dbP=foundP[0];
        const pbody={name:pname,username,photo:p.photo||null,team_id:dbTeam.id,position:p.position||null,rating:Number(p.rating||0),status:'active'};
        if(dbP) await patch('players','id=eq.'+esc(dbP.id),pbody); else {const x=await post('players',pbody);dbP=x?.[0];}
        if(dbP?.id){playerIds[String(p.id)]=dbP.id; await post('tournament_players',{tournament_id:tournamentId,player_id:dbP.id,team_id:dbTeam.id});}
      }
    }
    const standings={};
    Object.values(teamIds).forEach(id=>standings[id]={played:0,won:0,drawn:0,lost:0,goals_for:0,goals_against:0,points:0});
    for(const m of (t.fixtures||[])){
      const home=teamIds[String(m.home)], away=teamIds[String(m.away)]; if(!home||!away) continue;
      const hs=score(m,m.home), as=score(m,m.away);
      const body={tournament_id:tournamentId,home_team_id:home,away_team_id:away,home_score:hs,away_score:as,match_date:parseDateTime(m),round:String(m.round||m.stage||''),status:m.played?'completed':'scheduled',venue:m.venue||null,notes:JSON.stringify({clientId:String(m.id),stage:m.stage||'',group:m.group||'',time:m.time||'',motm:m.motm||null,homeGoalkeeper:m.homeGoalkeeper||null,awayGoalkeeper:m.awayGoalkeeper||null,goals:m.goals||[]})};
      const created=await post('matches',body);
      const dbMatch=created?.[0];
      if(dbMatch?.id && Array.isArray(m.goals)){
        for(const g of m.goals){
          const pt=playerIds[String(g.playerId)], tg=teamIds[String(g.teamId)];
          if(pt||tg) await post('match_goals',{match_id:dbMatch.id,player_id:pt||null,team_id:tg||null,minute:Number(g.minute)||null}).catch(()=>{});
        }
      }
      if(m.played){
        const a=standings[home], b=standings[away]; a.played++;b.played++;a.goals_for+=hs;a.goals_against+=as;b.goals_for+=as;b.goals_against+=hs;
        if(hs>as){a.won++;a.points+=3;b.lost++;} else if(hs<as){b.won++;b.points+=3;a.lost++;} else {a.drawn++;b.drawn++;a.points++;b.points++;}
      }
    }
    for(const [dbTeam,st] of Object.entries(standings)){
      await patch('tournament_teams','tournament_id=eq.'+esc(tournamentId)+'&team_id=eq.'+esc(dbTeam),st).catch(()=>{});
    }
    writeTournament(t);
    localStorage.setItem('arrowsSupabaseLastSync',new Date().toISOString());
  }
  function remoteTournamentToLocal(row,teamRows,playerRows,matchRows){
    const meta=row.description?.startsWith(metaPrefix)?json(row.description.slice(metaPrefix.length),{}):{};
    const teamByDb={}; const teams=[];
    for(const rel of teamRows){
      const tr=rel.team||rel; const tm={id:tr.id,name:tr.name,logo:tr.logo||'',players:[]};
      const metaTeam=tr.description?.startsWith(metaPrefix)?json(tr.description.slice(metaPrefix.length),{}):{}; if(metaTeam.clientId)tm.id=metaTeam.clientId;
      teamByDb[tr.id]=tm; teams.push(tm);
    }
    for(const pr of playerRows){
      const p=pr.player||pr, tm=teamByDb[pr.team_id]; if(!tm) continue;
      tm.players.push({id:p.id,name:p.name,efootballId:p.username?.startsWith('ARROWS_LOCAL_')?'':p.username||'',photo:p.photo||'',clanPlayerId:p.id});
    }
    const fixtures=matchRows.map(m=>{const n=json(m.notes||'{}',{}); const home=teamByDb[m.home_team_id]?.id||m.home_team_id, away=teamByDb[m.away_team_id]?.id||m.away_team_id; return {id:n.clientId||m.id,home,away,stage:n.stage||'',round:Number(m.round)||1,group:n.group||'',date:m.match_date?new Date(m.match_date).toISOString().slice(0,10):'',time:n.time||'',venue:m.venue||'',goals:Array.isArray(n.goals)?n.goals:[],motm:n.motm||null,homeGoalkeeper:n.homeGoalkeeper||null,awayGoalkeeper:n.awayGoalkeeper||null,played:m.status==='completed'};});
    return {...meta,_supabaseId:row.id,_supabaseUpdatedAt:row.updated_at||new Date().toISOString(),name:row.name||meta.name||'ARROWS DUO TOURNAMENT',type:row.type||meta.type||'roundrobin',teams,fixtures};
  }
  async function pullTournament(){
    const row=(await get('tournaments','order=updated_at.desc&limit=1&select=*'))[0]; if(!row) return false;
    const trs=await get('tournament_teams','tournament_id=eq.'+esc(row.id)+'&select=*,team:teams(*)');
    const prs=await get('tournament_players','tournament_id=eq.'+esc(row.id)+'&select=*,player:players(*)');
    const ms=await get('matches','tournament_id=eq.'+esc(row.id)+'&select=*');
    const local=remoteTournamentToLocal(row,trs,prs,ms); writeTournament(local); return true;
  }
  async function syncPlayers(){
    const arr=json(localStorage.getItem('arrowsClanPlayers'),[]); if(!Array.isArray(arr)||!arr.length)return;
    for(const p of arr){const username=p.efootballId||('ARROWS_LOCAL_'+String(p.id)); const found=await get('players','username=eq.'+esc(username)+'&select=*'); const body={name:p.name,username,photo:p.photo||null,status:'active'}; if(found[0]) await patch('players','id=eq.'+esc(found[0].id),body); else await post('players',body);}
  }
  async function syncRegistrations(){
    const arr=json(localStorage.getItem('players'),[]); if(!Array.isArray(arr)||!arr.length)return;
    for(const p of arr){await post('registrations',{player_name:p.name||'Player',username:p.efootballId||p.username||null,phone:p.phone||null,email:p.email||null,photo:p.photo||p.photoUrl||null,team_name:p.teamName||p.team||null,status:'pending',notes:'Imported from local website data'}).catch(()=>{});}
  }
  async function syncAll(){
    if(syncing)return; syncing=true;
    try{
      const t=readTournament();
      if(t) await syncTournament(t); else await pullTournament();
      await syncPlayers();
    }catch(e){console.warn('[ARROWS Supabase]',e); window.dispatchEvent(new CustomEvent('arrows:supabase-error',{detail:e.message}));}
    finally{syncing=false;initial=false;}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(syncAll,500)}
  const originalSet=localStorage.setItem.bind(localStorage);
  localStorage.setItem=function(k,v){originalSet(k,v); if(!initial && (k===LS||PLAYER_KEYS.includes(k))) schedule();};
  window.arrowsSupabase={sync:syncAll,pull:pullTournament};
  window.addEventListener('load',()=>{syncAll(); setInterval(()=>{if(document.visibilityState==='visible')syncAll()},60000)});
})();
