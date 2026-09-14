/* ARROWS ESPORTS - shared cloud player/tournament cache */
(function () {
  let playerCache = [];
  let tournamentCache = null;
  let quickTournamentCache = null;
  let readyPromise = null;

  function arrowsId() {
    return crypto.randomUUID();
  }

  window.arrowsEscape = function (value) {
    return String(value ?? "").replace(/[&<>'"]/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"
    }[c]));
  };

  async function loadQuickTournamentState() {
    const cfg = window.ARROWS_SUPABASE || {};
    const base = String(cfg.url || "").replace(/\/$/, "");
    const key = String(cfg.publishableKey || "");
    if (!base || !key) return null;

    try {
      const res = await fetch(
        base + "/rest/v1/quick_tournament_state?id=eq.main&select=data&limit=1",
        {
          cache:"no-store",
          headers:{apikey:key, Authorization:"Bearer " + key}
        }
      );
      if (!res.ok) return null;
      const rows = await res.json();
      return rows && rows.length && rows[0].data && typeof rows[0].data === "object"
        ? rows[0].data
        : null;
    } catch (error) {
      console.warn("Could not load Quick Tournament stats", error);
      return null;
    }
  }

  window.arrowsSetTournamentCache = function (t) {
    tournamentCache = t && typeof t === "object" ? t : null;
  };

  window.arrowsSetQuickTournamentCache = function (t) {
    quickTournamentCache = t && typeof t === "object" ? t : null;
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
        const [players, tournament, quick] = await Promise.all([
          ARROWS_DB.getPlayers(),
          ARROWS_DB.getTournament(),
          loadQuickTournamentState()
        ]);
        playerCache = players || [];
        tournamentCache = tournament || null;
        quickTournamentCache = quick || null;
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

  function arrowsDuoTournamentRecords() {
    const records = [];
    const duo = tournamentCache;
    if (!duo || !Array.isArray(duo.teams)) return records;

    const teamById = Object.fromEntries(duo.teams.map(t => [String(t.id), t]));
    const localPlayerById = {};
    const stats = {};

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
  }

  function arrowsQuickTournamentRecords() {
    const quick = quickTournamentCache;
    if (!quick || typeof quick !== "object") return [];

    const quickPlayers = Array.isArray(quick.players) ? quick.players : [];
    const quickById = Object.fromEntries(quickPlayers.map(p => [String(p.id), p]));
    const canonicalFrom = (clanPlayerId, quickPlayerId, name) => {
      if (clanPlayerId) return String(clanPlayerId);
      const qp = quickById[String(quickPlayerId || "")];
      if (qp && qp.clanPlayerId) return String(qp.clanPlayerId);
      const wanted = String(name || qp?.name || "").trim().toLowerCase();
      if (wanted) {
        const permanent = playerCache.find(p => String(p.name || "").trim().toLowerCase() === wanted);
        if (permanent) return String(permanent.id);
      }
      return qp ? String(qp.id) : null;
    };

    const fixtureById = id => (Array.isArray(quick.fixtures) ? quick.fixtures : [])
      .find(m => String(m.id) === String(id)) || null;
    const quickPlayerById = id => quickById[String(id)] || null;

    const resolveSource = (source, seen = new Set()) => {
      if (!source || typeof source !== "object") return null;
      if (source.type === "player") return quickPlayerById(source.id);
      if (source.type !== "winner" || !source.matchId) return null;
      const match = fixtureById(source.matchId);
      if (!match || seen.has(String(match.id))) return null;
      seen.add(String(match.id));
      return match.winnerId ? quickPlayerById(match.winnerId) : null;
    };

    const events = [];
    const seenKeys = new Set();
    (Array.isArray(quick.history) ? quick.history : []).forEach(h => {
      const key = String(h.id || `${h.instanceId || "legacy"}:${h.matchId || ""}`);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      events.push({
        key,
        instanceId:String(h.instanceId || "quick-history"),
        title:String(h.tournamentTitle || quick.title || "ARROWS QUICK TOURNAMENT"),
        homeCanonical:canonicalFrom(h.homeClanPlayerId, h.homePlayerId, h.homeName),
        awayCanonical:canonicalFrom(h.awayClanPlayerId, h.awayPlayerId, h.awayName),
        winnerCanonical:canonicalFrom(h.winnerClanPlayerId, h.winnerPlayerId, h.winnerName),
        homeScore:h.homeScore === null || h.homeScore === "" ? 0 : Math.max(0, Number(h.homeScore) || 0),
        awayScore:h.awayScore === null || h.awayScore === "" ? 0 : Math.max(0, Number(h.awayScore) || 0)
      });
    });

    (Array.isArray(quick.fixtures) ? quick.fixtures : []).forEach(m => {
      if (m.status !== "completed" || !m.winnerId) return;
      const home = resolveSource(m.homeSource, new Set([String(m.id)]));
      const away = resolveSource(m.awaySource, new Set([String(m.id)]));
      if (!home || !away) return;
      const key = `${quick.instanceId || "quick-current"}:${m.id}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      const winner = quickPlayerById(m.winnerId);
      events.push({
        key,
        instanceId:String(quick.instanceId || "quick-current"),
        title:String(quick.title || "ARROWS QUICK TOURNAMENT"),
        homeCanonical:canonicalFrom(home.clanPlayerId, home.id, home.name),
        awayCanonical:canonicalFrom(away.clanPlayerId, away.id, away.name),
        winnerCanonical:winner ? canonicalFrom(winner.clanPlayerId, winner.id, winner.name) : null,
        homeScore:m.homeScore === null || m.homeScore === "" ? 0 : Math.max(0, Number(m.homeScore) || 0),
        awayScore:m.awayScore === null || m.awayScore === "" ? 0 : Math.max(0, Number(m.awayScore) || 0)
      });
    });

    const groups = {};
    const ensure = (group, playerId) => {
      if (!playerId) return null;
      const id = String(playerId);
      if (!group.stats[id]) group.stats[id] = {
        goals:0, goalsConceded:0, assists:0, matches:0,
        wins:0, losses:0, draws:0, motm:0
      };
      return group.stats[id];
    };

    events.forEach(event => {
      if (!event.homeCanonical || !event.awayCanonical || !event.winnerCanonical) return;
      if (event.homeCanonical === event.awayCanonical) return;

      const key = event.instanceId || "quick";
      if (!groups[key]) groups[key] = {title:event.title, stats:{}};
      const group = groups[key];
      const home = ensure(group, event.homeCanonical);
      const away = ensure(group, event.awayCanonical);
      if (!home || !away) return;

      home.matches++;
      away.matches++;
      home.goals += event.homeScore;
      away.goals += event.awayScore;
      home.goalsConceded += event.awayScore;
      away.goalsConceded += event.homeScore;

      if (String(event.winnerCanonical) === String(event.homeCanonical)) {
        home.wins++;
        away.losses++;
      } else if (String(event.winnerCanonical) === String(event.awayCanonical)) {
        away.wins++;
        home.losses++;
      }
    });

    const records = [];
    Object.values(groups).forEach(group => {
      Object.entries(group.stats).forEach(([playerId, s]) => records.push({
        playerId,
        tournament:group.title || "ARROWS QUICK TOURNAMENT",
        teams:["Quick Tournament"],
        goals:s.goals,
        goalsConceded:s.goalsConceded,
        assists:s.assists,
        matches:s.matches,
        wins:s.wins,
        losses:s.losses,
        draws:s.draws,
        motm:s.motm
      }));
    });
    return records;
  }

  window.arrowsTournamentRecords = function () {
    return [...arrowsDuoTournamentRecords(), ...arrowsQuickTournamentRecords()];
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
