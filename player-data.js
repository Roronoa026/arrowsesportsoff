/* ARROWS ESPORTS - shared cloud player/tournament cache */
(function () {
  let playerCache = [];
  let tournamentCache = null;
  let readyPromise = null;

  function arrowsId() {
    return crypto.randomUUID();
  }
  window.arrowsEscape = function (value) {
    return String(value ?? "").replace(/[&<>'"]/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"
    }[c]));
  };

  window.arrowsSetTournamentCache = function (t) {
    tournamentCache = t && typeof t === "object" ? t : null;
  };

  window.arrowsGetPlayers = function () {
    return playerCache.slice();
  };

  window.arrowsGetPlayer = function (id) {
    return playerCache.find(p => String(p.id) === String(id)) || null;
  };

  window.arrowsReady = function (forceRefresh = false) {
    if (!readyPromise || forceRefresh) {
      readyPromise = (async () => {
        await ARROWS_DB.healthCheck();
        playerCache = await ARROWS_DB.getPlayers();
        tournamentCache = await ARROWS_DB.getTournament();
        return true;
      })();
    }
    return readyPromise;
  };

  window.arrowsRegisterPlayer = async function (data = {}) {
    await arrowsReady();
    const name = String(data.name || "").trim();
    if (!name) return null;

    let existing = playerCache.find(p =>
      (data.clanPlayerId && String(p.id) === String(data.clanPlayerId)) ||
      p.name.toLowerCase() === name.toLowerCase() ||
      (data.efootballId && p.efootballId &&
       p.efootballId.toLowerCase() === String(data.efootballId).toLowerCase())
    );

    const player = existing ? {
      ...existing,
      name,
      efootballId: data.efootballId !== undefined ? String(data.efootballId).trim() : existing.efootballId,
      country: data.country !== undefined ? String(data.country).trim() : existing.country,
      photo: data.photo !== undefined ? data.photo : existing.photo
    } : {
      id: data.clanPlayerId || arrowsId(),
      name,
      efootballId: String(data.efootballId || "").trim(),
      country: String(data.country || "").trim(),
      photo: data.photo || ""
    };

    const saved = await ARROWS_DB.savePlayer(player);
    const index = playerCache.findIndex(p => String(p.id) === String(saved.id));
    if (index >= 0) playerCache[index] = saved;
    else playerCache.push(saved);
    return saved;
  };

  window.arrowsDeletePlayer = async function (id) {
    await ARROWS_DB.deletePlayer(id);
    playerCache = playerCache.filter(p => String(p.id) !== String(id));
  };

  window.arrowsSyncDuoPlayers = async function (providedTournament) {
    await arrowsReady();
    const t = providedTournament || tournamentCache || await ARROWS_DB.getTournament();
    if (!t || !Array.isArray(t.teams)) return;

    let changed = false;
    for (const team of t.teams) {
      team.players = Array.isArray(team.players) ? team.players : [];
      for (const player of team.players) {
        const canonical = await arrowsRegisterPlayer({
          name: player.name,
          clanPlayerId: player.clanPlayerId,
          efootballId: player.efootballId,
          country: player.country,
          photo: player.photo
        });
        if (canonical && String(player.clanPlayerId || "") !== String(canonical.id)) {
          player.clanPlayerId = canonical.id;
          changed = true;
        }
      }
    }
    tournamentCache = t;
    if (changed) {
      tournamentCache = await ARROWS_DB.saveTournament(t);
    }
  };

  window.arrowsTournamentRecords = function () {
    const records = [];
    const duo = tournamentCache;
    if (!duo || !Array.isArray(duo.teams)) return records;

    const teamById = Object.fromEntries(duo.teams.map(t => [String(t.id), t]));
    const playerById = {};
    const stats = {};

    duo.teams.forEach(team => (team.players || []).forEach(p => {
      playerById[String(p.id)] = { player: p, team };
    }));

    const ensure = (cid, team) => {
      if (!cid) return null;
      cid = String(cid);
      if (!stats[cid]) stats[cid] = {
        goals:0, assists:0, matches:0, wins:0, losses:0, draws:0, motm:0, teams:new Set()
      };
      if (team && team.name) stats[cid].teams.add(team.name);
      return stats[cid];
    };

    duo.teams.forEach(team => (team.players || []).forEach(p => ensure(p.clanPlayerId, team)));

    (Array.isArray(duo.fixtures) ? duo.fixtures : []).forEach(match => {
      if (!match.played) return;
      const home = teamById[String(match.home)];
      const away = teamById[String(match.away)];
      if (!home || !away) return;

      const goals = Array.isArray(match.goals) ? match.goals : [];
      const homeScore = goals.filter(g => String(g.teamId) === String(home.id)).length;
      const awayScore = goals.filter(g => String(g.teamId) === String(away.id)).length;

      [home, away].forEach((team, idx) => (team.players || []).forEach(p => {
        const s = ensure(p.clanPlayerId, team);
        if (!s) return;
        s.matches++;
        if (homeScore === awayScore) s.draws++;
        else if ((idx === 0 && homeScore > awayScore) || (idx === 1 && awayScore > homeScore)) s.wins++;
        else s.losses++;
      }));

      goals.forEach(g => {
        const ref = playerById[String(g.playerId)];
        if (ref) {
          const s = ensure(ref.player.clanPlayerId, ref.team);
          if (s) s.goals++;
        }
      });

      if (match.motm) {
        const ref = playerById[String(match.motm)];
        if (ref) {
          const s = ensure(ref.player.clanPlayerId, ref.team);
          if (s) s.motm++;
        }
      }
    });

    Object.entries(stats).forEach(([id, s]) => records.push({
      playerId:id,
      tournament:duo.name || "ARROWS DUO TOURNAMENT",
      teams:[...s.teams],
      goals:s.goals, assists:s.assists, matches:s.matches,
      wins:s.wins, losses:s.losses, draws:s.draws, motm:s.motm
    }));
    return records;
  };

  window.arrowsPlayerStats = function (playerId) {
    const history = arrowsTournamentRecords().filter(r => String(r.playerId) === String(playerId));
    const out = {
      tournaments:history.length, goals:0, assists:0, matches:0,
      wins:0, losses:0, draws:0, motm:0, history
    };
    history.forEach(r => ["goals","assists","matches","wins","losses","draws","motm"]
      .forEach(k => out[k] += Number(r[k] || 0)));
    out.winRate = out.matches ? Math.round(out.wins / out.matches * 100) : 0;
    return out;
  };

  // Fixture generator retained for existing tournament UI.
  window.arrowsGenerateDuoFixtures = window.arrowsGenerateDuoFixtures || function(participants, groupCount) {
    const list = Array.isArray(participants) ? participants.filter(Boolean).slice() : [];
    let groups = Math.max(1, parseInt(groupCount, 10) || 1);
    groups = Math.min(groups, Math.max(1, list.length));
    const buckets = Array.from({length: groups}, () => []);
    list.forEach((item, i) => buckets[i % groups].push(item));
    const fixtures = [];
    buckets.forEach((bucket, gi) => {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          fixtures.push({
            group:String.fromCharCode(65 + gi),
            home:bucket[i], away:bucket[j],
            status:"scheduled", homeScore:null, awayScore:null
          });
        }
      }
    });
    return fixtures;
  };
})();
