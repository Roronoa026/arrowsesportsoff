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
    const localPlayerById = {};
    const stats = {};

    // Resolve any tournament/team-local player ID to the permanent clan player ID.
    duo.teams.forEach(team => (team.players || []).forEach(p => {
      localPlayerById[String(p.id)] = { player: p, team };
      if (p.clanPlayerId) localPlayerById[String(p.clanPlayerId)] = { player: p, team };
    }));

    const canonicalId = (playerId, team) => {
      if (!playerId) return null;
      const key = String(playerId);
      const inTeam = (team?.players || []).find(p =>
        String(p.id) === key || String(p.clanPlayerId || '') === key
      );
      if (inTeam) return String(inTeam.clanPlayerId || inTeam.id);
      const ref = localPlayerById[key];
      return ref ? String(ref.player.clanPlayerId || ref.player.id) : key;
    };

    const ensure = (cid, team) => {
      if (!cid) return null;
      cid = String(cid);
      if (!stats[cid]) stats[cid] = {
        goals:0, goalsConceded:0, assists:0, matches:0,
        wins:0, losses:0, draws:0, motm:0, teams:new Set()
      };
      if (team && team.name) stats[cid].teams.add(team.name);
      return stats[cid];
    };

    duo.teams.forEach(team => (team.players || []).forEach(p =>
      ensure(String(p.clanPlayerId || p.id), team)
    ));

    (Array.isArray(duo.fixtures) ? duo.fixtures : []).forEach(match => {
      if (!match.played) return;
      const home = teamById[String(match.home)];
      const away = teamById[String(match.away)];
      if (!home || !away) return;

      const result = match.result && typeof match.result === 'object' ? match.result : null;
      const playerStats = result && Array.isArray(result.playerStats) ? result.playerStats : [];

      if (playerStats.length) {
        // New result format: the admin-entered player rows are authoritative.
        playerStats.forEach(row => {
          const rowTeam = teamById[String(row.teamId)] ||
            ((home.players || []).some(p => String(p.id) === String(row.playerId) || String(p.clanPlayerId || '') === String(row.playerId)) ? home : away);
          const cid = canonicalId(row.playerId, rowTeam);
          const s = ensure(cid, rowTeam);
          if (!s) return;
          s.matches++;
          s.goals += Math.max(0, Number(row.goalsScored) || 0);
          s.goalsConceded += Math.max(0, Number(row.goalsConceded) || 0);
          const outcome = String(row.outcome || '').toLowerCase();
          if (outcome === 'win') s.wins++;
          else if (outcome === 'loss') s.losses++;
          else if (outcome === 'draw') s.draws++;
        });
      } else {
        // Legacy fallback for matches saved before per-player result rows existed.
        const goals = Array.isArray(match.goals) ? match.goals : [];
        const homeScore = result ? Number(result.homePoints || 0) : goals.filter(g => String(g.teamId) === String(home.id)).length;
        const awayScore = result ? Number(result.awayPoints || 0) : goals.filter(g => String(g.teamId) === String(away.id)).length;

        [home, away].forEach((team, idx) => (team.players || []).forEach(p => {
          const s = ensure(String(p.clanPlayerId || p.id), team);
          if (!s) return;
          s.matches++;
          const conceded = idx === 0 ? awayScore : homeScore;
          s.goalsConceded += Math.max(0, Number(conceded) || 0);
          if (homeScore === awayScore) s.draws++;
          else if ((idx === 0 && homeScore > awayScore) || (idx === 1 && awayScore > homeScore)) s.wins++;
          else s.losses++;
        }));

        goals.forEach(g => {
          const ref = localPlayerById[String(g.playerId)];
          const rowTeam = teamById[String(g.teamId)] || ref?.team;
          const cid = canonicalId(g.playerId, rowTeam);
          const s = ensure(cid, rowTeam);
          if (s) s.goals++;
        });
      }

      const mvpId = (result && result.mvp) || match.motm;
      if (mvpId) {
        const ref = localPlayerById[String(mvpId)];
        const cid = canonicalId(mvpId, ref?.team);
        const s = ensure(cid, ref?.team);
        if (s) s.motm++;
      }
    });

    Object.entries(stats).forEach(([id, s]) => records.push({
      playerId:id,
      tournament:duo.name || "ARROWS DUO TOURNAMENT",
      teams:[...s.teams],
      goals:s.goals,
      goalsConceded:s.goalsConceded,
      assists:s.assists,
      matches:s.matches,
      wins:s.wins,
      losses:s.losses,
      draws:s.draws,
      motm:s.motm
    }));
    return records;
  };

  window.arrowsPlayerStats = function (playerId) {
    const history = arrowsTournamentRecords().filter(r => String(r.playerId) === String(playerId));
    const out = {
      tournaments:history.filter(r => r.matches > 0).length,
      goals:0, goalsConceded:0, assists:0, matches:0,
      wins:0, losses:0, draws:0, motm:0, history:history.filter(r => r.matches > 0)
    };
    out.history.forEach(r => ["goals","goalsConceded","assists","matches","wins","losses","draws","motm"]
      .forEach(k => out[k] += Number(r[k] || 0)));
    out.winRate = out.matches ? Math.round(out.wins / out.matches * 100) : 0;
    out.goalDifference = out.goals - out.goalsConceded;
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
