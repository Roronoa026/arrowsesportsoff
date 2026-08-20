
/* ARROWS FIXTURE ENGINE v5
   Robust group-aware round-robin fixture generation.
   Accepts an array of team/player names or objects; returns fixture objects.
*/
function arrowsGenerateDuoFixtures(participants, groupCount) {
  const list = Array.isArray(participants) ? participants.filter(Boolean).slice() : [];
  let groups = Math.max(1, parseInt(groupCount, 10) || 1);
  groups = Math.min(groups, Math.max(1, list.length));

  // Split as evenly as possible, preserving input order.
  const buckets = Array.from({length: groups}, () => []);
  list.forEach((item, i) => buckets[i % groups].push(item));

  const fixtures = [];
  buckets.forEach((bucket, gi) => {
    // A group with fewer than 2 participants has no fixture.
    if (bucket.length < 2) return;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        fixtures.push({
          group: String.fromCharCode(65 + gi),
          home: bucket[i],
          away: bucket[j],
          status: "scheduled",
          homeScore: null,
          awayScore: null
        });
      }
    }
  });
  return fixtures;
}

/* ARROWS ESPORTS - Shared Player Database */
const ARROWS_PLAYERS_KEY = 'arrowsClanPlayers';
function arrowsGetPlayers(){try{return JSON.parse(localStorage.getItem(ARROWS_PLAYERS_KEY))||[]}catch(e){return[]}}
function arrowsSavePlayers(players){localStorage.setItem(ARROWS_PLAYERS_KEY,JSON.stringify(players))}
function arrowsId(){return 'ARR-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,7).toUpperCase()}
function arrowsRegisterPlayer(data={}){
 const players=arrowsGetPlayers(), name=String(data.name||'').trim(); if(!name)return null;
 const existing=players.find(p=>(data.clanPlayerId&&p.id===data.clanPlayerId)||p.name.toLowerCase()===name.toLowerCase()||(data.efootballId&&p.efootballId&&p.efootballId.toLowerCase()===String(data.efootballId).toLowerCase()));
 if(existing){if(data.name)existing.name=name;if(data.efootballId!==undefined)existing.efootballId=String(data.efootballId).trim();if(data.country!==undefined)existing.country=String(data.country).trim();if(data.photo!==undefined)existing.photo=data.photo;arrowsSavePlayers(players);return existing}
 const player={id:arrowsId(),name,efootballId:String(data.efootballId||'').trim(),country:String(data.country||'').trim(),photo:data.photo||'',createdAt:new Date().toISOString()};
 players.push(player);arrowsSavePlayers(players);return player;
}
function arrowsGetPlayer(id){return arrowsGetPlayers().find(p=>p.id===id)||null}
function arrowsDeletePlayer(id){arrowsSavePlayers(arrowsGetPlayers().filter(p=>p.id!==id))}
function arrowsEscape(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function arrowsSyncDuoPlayers(){
 let tournament;try{tournament=JSON.parse(localStorage.getItem('footballTournament'))}catch(e){tournament=null}
 if(!tournament||!Array.isArray(tournament.teams))return;
 let changed=false;tournament.teams.forEach(team=>(team.players||[]).forEach(player=>{
  const canonical=arrowsRegisterPlayer({name:player.name,clanPlayerId:player.clanPlayerId,efootballId:player.efootballId,country:player.country,photo:player.photo});
  if(canonical&&player.clanPlayerId!==canonical.id){player.clanPlayerId=canonical.id;changed=true}
 }));if(changed)localStorage.setItem('footballTournament',JSON.stringify(tournament));
}
function arrowsTournamentRecords(){
 const records=[];let duo=null;try{duo=JSON.parse(localStorage.getItem('footballTournament'))}catch(e){}
 if(duo&&Array.isArray(duo.teams)){
  const teamById=Object.fromEntries(duo.teams.map(t=>[String(t.id),t])), playerById={}, stats={};
  duo.teams.forEach(team=>(team.players||[]).forEach(p=>{playerById[String(p.id)]={player:p,team}}));
  const ensure=(cid,player,team)=>{if(!cid)return null;if(!stats[cid])stats[cid]={goals:0,assists:0,matches:0,wins:0,losses:0,draws:0,motm:0,teams:new Set()};stats[cid].teams.add(team.name);return stats[cid]};
  duo.teams.forEach(team=>(team.players||[]).forEach(p=>ensure(p.clanPlayerId,p,team)));
  (Array.isArray(duo.fixtures)?duo.fixtures:[]).forEach(match=>{
   if(!match.played)return;
   const home=teamById[String(match.home)], away=teamById[String(match.away)]; if(!home||!away)return;
   const homeScore=(match.goals||[]).filter(g=>String(g.teamId)===String(home.id)).length;
   const awayScore=(match.goals||[]).filter(g=>String(g.teamId)===String(away.id)).length;
   [home,away].forEach((team,idx)=>(team.players||[]).forEach(p=>{const s=ensure(p.clanPlayerId,p,team);if(!s)return;s.matches++;if(homeScore===awayScore)s.draws++;else if((idx===0&&homeScore>awayScore)||(idx===1&&awayScore>homeScore))s.wins++;else s.losses++}));
   (match.goals||[]).forEach(g=>{const ref=playerById[String(g.playerId)];if(ref){const s=ensure(ref.player.clanPlayerId,ref.player,ref.team);if(s)s.goals++}});
   if(match.motm){const ref=playerById[String(match.motm)];if(ref){const s=ensure(ref.player.clanPlayerId,ref.player,ref.team);if(s)s.motm++}}
  });
  Object.entries(stats).forEach(([id,s])=>records.push({playerId:id,tournament:duo.name||'ARROWS DUO TOURNAMENT',teams:[...s.teams],goals:s.goals,assists:s.assists,matches:s.matches,wins:s.wins,losses:s.losses,draws:s.draws,motm:s.motm}));
 }
 return records;
}
function arrowsPlayerStats(playerId){
 const history=arrowsTournamentRecords().filter(r=>r.playerId===playerId);
 const out={tournaments:history.length,goals:0,assists:0,matches:0,wins:0,losses:0,draws:0,motm:0,history};
 history.forEach(r=>['goals','assists','matches','wins','losses','draws','motm'].forEach(k=>out[k]+=r[k]||0));
 out.winRate=out.matches?Math.round(out.wins/out.matches*100):0;return out;
}
arrowsSyncDuoPlayers();
