// FLASH host-character lines for Shutterbox. Picked at random per event;
// `{{var}}` placeholders are filled by `fill()` from per-event vars.

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] !== undefined ? vars[k] : '');
}

const gameStart = [
  "SHUTTERBOX IS LIVE and your aura is about to be TESTED. Three rounds. One champion. Everyone else? Cooked.",
  "Welcome to SHUTTERBOX, legends. I'm Flash. I'll be roasting your photos and losing my mind for the next twenty minutes. Let's GO.",
  "SHUTTERBOX BABY. Three rounds of chaos, one winner, and a LOT of questionable camera roll decisions. I am SO ready.",
  "Alright besties, it's SHUTTERBOX time. Your photos are about to be dragged in front of everyone you love. No survivors.",
  "The lobby is FULL, the vibes are immaculate, and I am UNWELL with excitement. SHUTTERBOX. RIGHT NOW. LET'S EAT."
];

const roundIntro = {
  1: [
    "Round 1! Warm-up round, kings. Show me what those camera rolls are hiding. And I KNOW they're hiding something.",
    "Round 1! Your photos are about to be judged by your friends. Your FRIENDS. The people who know you. No pressure.",
    "First round baby! Time to dig through that camera roll. We ALL have crimes in there. Don't be shy.",
    "Round 1! We're starting slow. Emphasis on SLOW. This will NOT stay calm. I promise you that.",
    "Opening round! Dust off those camera rolls and show me something LEGENDARY. Or terrible. Both work honestly."
  ],
  2: [
    "Round 2! New prompts, new matchups, same absolutely UNHINGED photo choices. I love this game.",
    "Round 2 and things are HEATING up! If you phoned it in during Round 1 that's on YOU. Time to lock in.",
    "Alright legends, Round 2! Last head-to-head round before the Showdown. Make. It. COUNT.",
    "Round 2! The aura check just got HARDER. Bring your best or get absolutely farmed. Your call.",
    "Round 2 BABY! The stakes are higher, the photos better be harder, and I am losing my MIND already."
  ]
};

const matchupTease = [
  "Alright. Next matchup. I've seen what's coming and I need everyone to BRACE themselves.",
  "Oh. Oh NO. This next one. I'm not okay. YOU'RE not gonna be okay. Let's look.",
  "Next matchup coming in HOT. And by hot I mean someone is about to get COOKED.",
  "Okay here we go. I'm not saying this one's personal but... it's a LITTLE personal.",
  "This next matchup goes SO hard. Or maybe it doesn't. I genuinely cannot tell. Let's find out together.",
  "Buckle UP because this next one has aura that I was not prepared for.",
  "Next! I want everyone to take a deep breath. Good. Now look at THIS.",
  "Loading the next matchup and I am SWEATING. The content. THE CONTENT.",
  "Alright alright alright. Next one. Try not to scream. I already did.",
  "New matchup just dropped and it's giving EVERYTHING. Or nothing. The duality.",
  "Plot twist incoming. This next matchup is a VIBE and I need you all to witness it.",
  "I've been waiting for this one. Oh you're NOT ready. Nobody is ready."
];

const voteResult = {
  shutout: [
    "SHUTOUT! {{winner}} just sent {{loser}} to the SHADOW REALM. That photo had ZERO defenders. Negative aura.",
    "ONE HUNDRED TO ZERO. {{winner}} committed a photographic WAR CRIME. {{loser}} I am so sorry. No I'm not. That was brutal.",
    "SHUTOUT BABY! {{winner}} ate and left NO crumbs. {{loser}} you got absolutely DELETED. GG go next.",
    "FLAWLESS VICTORY. {{winner}} just ended {{loser}}'s whole career and I'm not even being dramatic. Okay maybe a little.",
    "NOT A SINGLE VOTE for {{loser}}! {{winner}} went full sigma and the lobby AGREED. That's a shutout kings."
  ],
  landslide: [
    "{{winner}} takes it at {{pct}}%! That's not a win that's a STATEMENT. {{loser}} you got farmed no cap.",
    "{{pct}}% for {{winner}}! No diff. {{loser}} your photo had... personality. Let's go with personality.",
    "{{winner}} ran that at {{pct}}%. DOMINANT. {{loser}} brought a side quest photo to a main story fight.",
    "Commanding W for {{winner}} at {{pct}}%! {{loser}} I believe in you but the people have SPOKEN."
  ],
  close: [
    "{{pct}}% to {{winner}}! That was RAZOR close. Both photos ate honestly. Respect to {{loser}}.",
    "OH that was TIGHT! {{winner}} barely edges it at {{pct}}%. {{loser}} you were RIGHT THERE. That's pain.",
    "{{winner}} with {{pct}}%! By a HAIR. This matchup had me on the edge of my seat and I don't even have a seat.",
    "SO close! {{winner}} clutches it at {{pct}}%. {{loser}} that was NOT a bad photo. The lobby was DIVIDED."
  ],
  tie: [
    "FIFTY FIFTY. The lobby is SPLIT. The universe ITSELF could not decide. Both photos had equal aura and I'm shook.",
    "Dead even! 50/50! Both photos went equally hard and now I'm having an existential crisis about it.",
    "A PERFECT TIE. The duality of this lobby. Both photos ate. Neither photo lost. I need to lie down.",
    "50/50 SPLIT! You BOTH cooked! This is the most respectful outcome possible and I'm here for it."
  ]
};

const finalIntro = [
  "THE SHUTTER SHOWDOWN. One prompt. EVERYONE answers. The points are MASSIVE and I am losing my MIND.",
  "It's SHOWDOWN TIME baby. One prompt to rule them all. This is where legends are MADE and auras are TESTED.",
  "SHUTTER SHOWDOWN! Everyone gets the same prompt. Winner gets a MOUNTAIN of points. This. Is. EVERYTHING.",
  "The final round. THE SHUTTER SHOWDOWN. I have been WAITING for this. The entire leaderboard is about to change.",
  "SHOWDOWN. One prompt. Everyone competes. The points are RIDICULOUS. Your camera roll is your weapon. CHOOSE WISELY."
];

const finalResult = [
  "The votes are IN and that gallery was absolutely STACKED. What a showdown! I'm emotionally drained.",
  "LOOK at those results! That Showdown had everything. Drama. Aura. Questionable photos. Beautiful.",
  "The Showdown results are in and I am NOT okay. That was INCREDIBLE. Every single entry went hard.",
  "What a GALLERY. The people have voted and honestly? Everyone cooked in that round. But only one can win."
];

const gameOver = [
  "{{winner}} takes the crown with {{score}} points! Absolute LEGEND. Everyone else? Still goated in my book. Run it back?",
  "GG EVERYBODY! {{winner}} wins with {{score}} points! That's a hard carry right there. Champion behavior.",
  "AND YOUR SHUTTERBOX CHAMPION IS... {{winner}}! {{score}} points! I'm getting that tattooed on my back. What a game.",
  "{{winner}} with {{score}} points is your WINNER! Incredible performance. Everyone else — you're all cracked, don't let anyone tell you different."
];

module.exports = {
  getGameStartLine: () => pick(gameStart),
  getRoundIntroLine: (round) => pick(roundIntro[round] || roundIntro[1]),
  getMatchupTeaseLine: () => pick(matchupTease),
  getVoteResultLine: ({ winnerName, loserName, winnerPct, isShutout }) => {
    const vars = { winner: winnerName, loser: loserName, pct: winnerPct };
    if (isShutout) return fill(pick(voteResult.shutout), vars);
    if (winnerPct === 50) return fill(pick(voteResult.tie), vars);
    if (winnerPct >= 75) return fill(pick(voteResult.landslide), vars);
    return fill(pick(voteResult.close), vars);
  },
  getFinalIntroLine: () => pick(finalIntro),
  getFinalResultLine: () => pick(finalResult),
  getGameOverLine: ({ winnerName, score }) => fill(pick(gameOver), { winner: winnerName, score })
};
