/* ARROWS eSports - relational Supabase data layer
   Source of truth: tournaments, teams, tournament_teams, players, matches,
   match_goals, awards. No tournament_state/localStorage dependency. */
(function(){
  const cfg=window.ARROWS_SUPABASE||{};
  const BASE=String(cfg.url||"").replace(/\/$/,"");
  const KEY=String(cfg.publishableKey||"");
  if(!BASE||!KEY) throw new Error("Missing Supabase URL/key in supabase-config.js");

  const H={apikey:KEY,Authorization:"Bearer "+KEY,"Content-Type":"application/json"};

  async function req(path,opt={}){
    const r=await fetch(BASE+"/rest/v1/"+path,{...opt,cache:"no-store",headers:{...H,...(opt.headers||{})}});
    const raw=await r.text(); let data=null;
    try{data=raw?JSON.parse(raw):null}catch{data=raw}
    if(!r.ok) throw new Error((data&&(data.message||data.details||data.hint))||raw||("HTTP "+r.status));
    return data;
  }
  const uuid=()=>crypto.randomUUID();

  async function ensureTournament(){
    let rows=await req("tournaments?select=*&order=created_at.asc&limit=1");
    if(rows&&rows.length)return rows[0];
    rows=await req("tournaments",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({
      id:uuid(),name:"ARROWS DUO TOURNAMENT",type:"roundrobin",status:"active"
    })});
    return rows[0];
  }

  function localDateParts(value){
    if(!value) return {date:"",time:""};
    const dt=new Date(value);
    if(Number.isNaN(dt.getTime())) return {date:"",time:""};
    const pad=n=>String(n).padStart(2,"0");
    return {
      date:`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`,
      time:`${pad(dt.getHours())}:${pad(dt.getMinutes())}`
    };
  }

  function matchToLegacy(m,goals,awards){
    const dt=localDateParts(m.match_date);
    const motm=(awards||[]).find(a=>a.award_type==="motm");
    return {
      id:m.id,home:m.home_team_id,away:m.away_team_id,
      stage:m.stage||"League",round:m.round||1,group:m.group_name||"",
      date:dt.date,time:dt.time,
      venue:m.venue||"",played:m.status==="completed",
      goals:(goals||[]).map(g=>({id:g.id,teamId:g.team_id,playerId:g.player_id,minute:g.minute??""})),
      motm:motm?motm.player_id:null,
      homeGoalkeeper:m.home_goalkeeper_id||null,awayGoalkeeper:m.away_goalkeeper_id||null
    };
  }

  async function loadTournament(){
    const t=await ensureTournament();
    const links=await req("tournament_teams?tournament_id=eq."+encodeURIComponent(t.id)+"&select=team_id");
    const ids=(links||[]).map(x=>x.team_id);
    let teams=[];
    if(ids.length){
      teams=await req("teams?id=in.("+ids.map(encodeURIComponent).join(",")+")&select=*&order=created_at.asc");
    }
    const players=await req("players?select=*&order=created_at.asc");
    const matches=await req("matches?tournament_id=eq."+encodeURIComponent(t.id)+"&select=*&order=match_date.asc.nullslast,created_at.asc");
    const mids=(matches||[]).map(x=>x.id);
    let goals=[],awards=[];
    if(mids.length){
      goals=await req("match_goals?match_id=in.("+mids.map(encodeURIComponent).join(",")+")&select=*");
      awards=await req("awards?tournament_id=eq."+encodeURIComponent(t.id)+"&select=*");
    }
    const teamObjs=(teams||[]).map(team=>({
      id:team.id,name:team.name,logo:team.logo||"",
      players:(players||[]).filter(p=>p.team_id===team.id).map(p=>({
        id:p.id,name:p.name,clanPlayerId:p.id,country:p.country||"",photo:p.photo||"",efootballId:p.efootball_id||""
      }))
    }));
    return {
      id:t.id,name:t.name,type:t.type||"roundrobin",season:t.description||"",
      organizer:"",leagueFormat:"single",leagueGroups:2,knockoutReady:false,
      teams:teamObjs,
      fixtures:(matches||[]).map(m=>matchToLegacy(m,goals.filter(g=>g.match_id===m.id),awards.filter(a=>a.match_id===m.id)))
    };
  }

  async function saveTeam(team,tournamentId){
    const row={id:team.id&&String(team.id).includes("-")?team.id:uuid(),name:team.name,logo:team.logo||""};
    const saved=await req("teams?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(row)});
    team.id=saved[0].id;
    await req("tournament_teams?on_conflict=tournament_id,team_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({tournament_id:tournamentId,team_id:team.id})});
    return team;
  }

  async function savePlayer(player,teamId){
    const id=(player.clanPlayerId&&String(player.clanPlayerId).includes("-"))?player.clanPlayerId:
             (player.id&&String(player.id).includes("-")?player.id:uuid());
    const row={id,name:player.name,team_id:teamId,country:player.country||"",photo:player.photo||"",efootball_id:player.efootballId||""};
    const saved=await req("players?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(row)});
    player.id=saved[0].id; player.clanPlayerId=saved[0].id; return player;
  }

  async function saveMatch(m,tournamentId){
    const id=(m.id&&String(m.id).includes("-"))?m.id:uuid(); m.id=id;
    let match_date=null;
    if(m.date){ match_date=new Date(m.date+"T"+(m.time||"00:00")+":00").toISOString(); }
    const homeScore=(m.goals||[]).filter(g=>String(g.teamId)===String(m.home)).length;
    const awayScore=(m.goals||[]).filter(g=>String(g.teamId)===String(m.away)).length;
    const row={id,tournament_id:tournamentId,home_team_id:m.home,away_team_id:m.away,home_score:homeScore,away_score:awayScore,
      match_date,round:Number(m.round)||1,status:m.played?"completed":"scheduled",venue:m.venue||"",
      stage:m.stage||"League",group_name:m.group||"",home_goalkeeper_id:m.homeGoalkeeper||null,away_goalkeeper_id:m.awayGoalkeeper||null};
    await req("matches?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)});
    await req("match_goals?match_id=eq."+encodeURIComponent(id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
    if((m.goals||[]).length){
      const rows=m.goals.map(g=>({id:(g.id&&String(g.id).includes("-"))?g.id:uuid(),match_id:id,player_id:g.playerId,team_id:g.teamId,minute:g.minute===""?null:Number(g.minute)}));
      await req("match_goals",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows)});
    }
    await req("awards?match_id=eq."+encodeURIComponent(id)+"&award_type=eq.motm",{method:"DELETE",headers:{Prefer:"return=minimal"}});
    if(m.motm) await req("awards",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({id:uuid(),tournament_id:tournamentId,match_id:id,player_id:m.motm,award_type:"motm",title:"Man of the Match"})});
  }

  window.ARROWS_DB={
    async healthCheck(){await req("tournaments?select=id&limit=1");return true},
    async getTournament(){return loadTournament()},
    async saveTournament(state){
      let t=await ensureTournament();
      await req("tournaments?id=eq."+encodeURIComponent(t.id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({name:state.name||t.name,type:state.type||t.type,description:state.season||t.description,status:"active"})});
      for(const team of state.teams||[]){
        await saveTeam(team,t.id);
        for(const player of team.players||[]) await savePlayer(player,team.id);
      }

      // Reconcile matches, not just upsert them. Without this, fixtures removed
      // in the admin UI remain in Supabase and reappear on the next reload.
      const existingMatches=await req("matches?tournament_id=eq."+encodeURIComponent(t.id)+"&select=id");
      const keepIds=new Set((state.fixtures||[]).map(m=>String(m.id)));
      for(const existing of existingMatches||[]){
        if(keepIds.has(String(existing.id))) continue;
        await req("awards?match_id=eq."+encodeURIComponent(existing.id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
        await req("match_goals?match_id=eq."+encodeURIComponent(existing.id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
        await req("matches?id=eq."+encodeURIComponent(existing.id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
      }

      for(const m of state.fixtures||[]) await saveMatch(m,t.id);
      return loadTournament();
    },
    async getPlayers(){return req("players?select=*&order=created_at.asc")},
    async savePlayer(p){
      const id=(p.id&&String(p.id).includes("-"))?p.id:uuid();
      const rows=await req("players?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({
        id,name:p.name,efootball_id:p.efootballId||p.efootball_id||"",country:p.country||"",photo:p.photo||"",team_id:p.team_id||null
      })}); return rows[0];
    },
    async deletePlayer(id){await req("players?id=eq."+encodeURIComponent(id),{method:"DELETE"});return true},
    async deleteTeam(id){await req("teams?id=eq."+encodeURIComponent(id),{method:"DELETE"});return true},
    async deleteMatch(id){
      // Delete dependent rows first so this works even when the database
      // foreign keys are not configured with ON DELETE CASCADE.
      await req("awards?match_id=eq."+encodeURIComponent(id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
      await req("match_goals?match_id=eq."+encodeURIComponent(id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
      await req("matches?id=eq."+encodeURIComponent(id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
      return true
    }
  };
})();