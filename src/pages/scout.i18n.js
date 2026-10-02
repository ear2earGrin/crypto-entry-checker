/**
 * Scout's strings, English and Greek.
 *
 * Greek exists because the desk has a Greek reader; the other tabs are still
 * English and fall back to it automatically (see src/i18n.js). Coin names and
 * tickers are never translated — BTC is BTC — and neither are the shell
 * commands in the empty state.
 *
 * Numbers stay formatted the way the rest of the desk formats them (plain
 * dot-decimals, "$1.2M"), because the page is read next to exchange screens
 * that do the same. Only words are translated.
 */

export const SCOUT_STRINGS = {
  // ——— Header ———————————————————————————————————————————————————————————
  eyebrow: {
    en: "Narrative discovery · companion to Crypto System v2.0",
    el: "Ανακάλυψη αφηγημάτων · συμπλήρωμα του Crypto System v2.0",
  },
  title: { en: "Narrative Scout", el: "Narrative Scout" },
  lede: {
    en: "Finds the narratives money is rotating into, explains each coin, measures its supply and liquidity risk, and tests the best pick with paper money.",
    el: "Βρίσκει τα αφηγήματα προς τα οποία μετακινείται το χρήμα, εξηγεί κάθε νόμισμα, μετρά τον κίνδυνο προσφοράς και ρευστότητάς του και δοκιμάζει την καλύτερη επιλογή με εικονικά χρήματα.",
  },
  lastScan: {
    en: (day, scanAgo, newsAgo) => `Last scan ${day} (${scanAgo}) · news ${newsAgo} · rescans daily after the UTC close, news hourly`,
    el: (day, scanAgo, newsAgo) => `Τελευταία σάρωση ${day} (${scanAgo}) · ειδήσεις ${newsAgo} · νέα σάρωση κάθε μέρα μετά το κλείσιμο UTC, ειδήσεις κάθε ώρα`,
  },
  reload: { en: "Reload", el: "Ανανέωση" },
  checking: { en: "Checking…", el: "Έλεγχος…" },

  // ——— Relative time ————————————————————————————————————————————————————
  none: { en: "–", el: "–" },
  minsAgo: { en: (n) => `${n}m ago`, el: (n) => `πριν ${n} λ` },
  hoursAgo: { en: (n) => `${n}h ago`, el: (n) => `πριν ${n} ώ` },
  daysAgo: { en: (n) => `${n}d ago`, el: (n) => `πριν ${n} ημ` },

  // ——— Reload status ————————————————————————————————————————————————————
  checkFailed: {
    en: (at, err) => `Checked ${at} — couldn't load (${err}).`,
    el: (at, err) => `Έλεγχος ${at} — αποτυχία φόρτωσης (${err}).`,
  },
  checkUpdated: {
    en: (at) => `Updated ${at} — new data loaded.`,
    el: (at) => `Ενημερώθηκε ${at} — φορτώθηκαν νέα δεδομένα.`,
  },
  checkSame: {
    en: (at, when) => `Checked ${at} — no new data yet; ${when}.`,
    el: (at, when) => `Έλεγχος ${at} — δεν υπάρχουν νέα δεδομένα· ${when}.`,
  },
  nextAround: { en: (at) => `next update around ${at}`, el: (at) => `επόμενη ενημέρωση γύρω στις ${at}` },
  dueNow: { en: "the Mac's next hourly run is due now", el: "η επόμενη ωριαία εκτέλεση του Mac οφείλεται τώρα" },

  // ——— Empty state ——————————————————————————————————————————————————————
  loadingScan: { en: "Loading the latest scan…", el: "Φόρτωση της τελευταίας σάρωσης…" },
  noDataYet: { en: "No Scout data yet", el: "Δεν υπάρχουν ακόμη δεδομένα Scout" },
  noDataProd: {
    en: "This page shows the snapshot the Mac mini publishes every hour. Nothing has been published yet. On the Mac, in the project folder:",
    el: "Η σελίδα δείχνει το στιγμιότυπο που δημοσιεύει το Mac mini κάθε ώρα. Δεν έχει δημοσιευτεί τίποτα ακόμη. Στο Mac, μέσα στον φάκελο του project:",
  },
  noDataDev: {
    en: "The Scout runs on the Mac mini and this page reads what it writes. In Terminal, in the project folder:",
    el: "Ο Scout τρέχει στο Mac mini και η σελίδα διαβάζει ό,τι γράφει. Στο Terminal, μέσα στον φάκελο του project:",
  },
  // Shell comments inside the setup block. The commands themselves never change.
  cmdFirstScan: { en: "# first scan now (takes ~1–2 minutes)", el: "# πρώτη σάρωση τώρα (διαρκεί ~1–2 λεπτά)" },
  cmdInstall: { en: "# then run it every hour automatically", el: "# μετά τρέχει αυτόματα κάθε ώρα" },

  // ——— Banners ——————————————————————————————————————————————————————————
  selftestTitle: { en: "Selftest data.", el: "Δεδομένα selftest." },
  selftestBody: {
    en: "Synthetic coins and prices. Run node scripts/scout.mjs on the Mac for the real scan.",
    el: "Τεχνητά νομίσματα και τιμές. Τρέξε node scripts/scout.mjs στο Mac για την πραγματική σάρωση.",
  },
  scanFailedTitle: { en: (when) => `Market scan failed ${when}.`, el: (when) => `Η σάρωση αγοράς απέτυχε ${when}.` },
  sourceOk: { en: "ok", el: "εντάξει" },
  sourceUnreached: { en: "not reached", el: "δεν απαντά" },
  lastGoodScan: { en: (day) => ` Showing the last good scan (${day}).`, el: (day) => ` Εμφανίζεται η τελευταία επιτυχημένη σάρωση (${day}).` },
  neverScanned: {
    en: " No scan has succeeded yet; news still updates.",
    el: " Καμία σάρωση δεν έχει πετύχει ακόμη· οι ειδήσεις συνεχίζουν να ενημερώνονται.",
  },
  retriesHourly: { en: " It retries every hour.", el: " Ξαναπροσπαθεί κάθε ώρα." },
  regimeBannerTitle: { en: (state) => `BTC regime is ${state}.`, el: (state) => `Το καθεστώς του BTC είναι ${state}.` },
  regimeBannerBody: {
    en: "The Scout keeps watching but opens no new test positions until BTC's weekly regime is bullish.",
    el: "Ο Scout συνεχίζει να παρακολουθεί αλλά δεν ανοίγει νέες δοκιμαστικές θέσεις μέχρι το εβδομαδιαίο καθεστώς του BTC να γίνει ανοδικό.",
  },
  unknown: { en: "unknown", el: "άγνωστο" },

  // ——— The operating rule ———————————————————————————————————————————————
  ruleAria: { en: "The operating rule", el: "Ο κανόνας λειτουργίας" },
  narrativeDecides: { en: "Narrative decides", el: "Το αφήγημα αποφασίζει" },
  whatToWatch: { en: "what to watch", el: "τι παρακολουθούμε" },
  scoutBuilds: { en: "The Scout builds the watchlist", el: "Ο Scout φτιάχνει τη λίστα παρακολούθησης" },
  priceDecides: { en: "Price decides", el: "Η τιμή αποφασίζει" },
  when: { en: "when", el: "πότε" },
  pickRuleFires: { en: "The pick rule fires, or nothing happens", el: "Ο κανόνας επιλογής ενεργοποιείται, ή δεν γίνεται τίποτα" },
  riskDecides: { en: "Risk decides", el: "Το ρίσκο αποφασίζει" },
  howMuch: { en: "how much", el: "πόσο" },
  testPerPick: {
    en: (amount) => `${amount} test per pick, stop set at entry`,
    el: (amount) => `${amount} δοκιμή ανά επιλογή, stop ορίζεται στην είσοδο`,
  },

  // ——— Rotation board ———————————————————————————————————————————————————
  rotationBoard: { en: "Narrative rotation board", el: "Πίνακας εναλλαγής αφηγημάτων" },
  live: { en: "live", el: "ζωντανά" },
  rotationHelp: {
    en: "Each row is an equal-weight basket. Cells show performance relative to BTC. Breadth is the share of the basket beating BTC over 30 days.",
    el: "Κάθε γραμμή είναι ένα καλάθι με ίσες στάθμες. Τα κελιά δείχνουν απόδοση σε σχέση με το BTC. Το εύρος είναι το ποσοστό του καλαθιού που ξεπερνά το BTC στις 30 ημέρες.",
  },
  thNarrative: { en: "Narrative", el: "Αφήγημα" },
  th7dVsBtc: { en: "7d vs BTC", el: "7η έναντι BTC" },
  th30d: { en: "30d", el: "30η" },
  th200d: { en: "200d", el: "200η" },
  th30dVsBtc: { en: "30d vs BTC", el: "30η έναντι BTC" },
  thBreadth: { en: "Breadth", el: "Εύρος" },
  thHeat: { en: "Heat", el: "Θερμότητα" },
  thStage: { en: "Stage", el: "Στάδιο" },
  leader: { en: (sym) => `Leader ${sym}`, el: (sym) => `Ηγέτης ${sym}` },
  sevenD: { en: "7d", el: "7η" },
  oneCoinCarrying: { en: "one coin carrying it", el: "ένα νόμισμα το κρατά μόνο του" },
  coinsOutsideTop: {
    en: (n) => `${n} coin${n > 1 ? "s" : ""} outside top 1,000`,
    el: (n) => `${n} ${n > 1 ? "νομίσματα" : "νόμισμα"} εκτός των 1.000 μεγαλύτερων`,
  },
  hottestCategories: { en: "Hottest CoinGecko categories, 24h:", el: "Πιο θερμές κατηγορίες CoinGecko, 24ω:" },

  // ——— Stages ———————————————————————————————————————————————————————————
  ACCELERATING: { en: "Accelerating", el: "Επιταχύνεται" },
  EMERGING: { en: "Emerging", el: "Αναδύεται" },
  MAINSTREAM: { en: "Mainstream", el: "Καθιερωμένο" },
  EXHAUSTING: { en: "Exhausting", el: "Εξαντλείται" },
  COLD: { en: "Cold", el: "Ψυχρό" },
  UNKNOWN: { en: "Unknown", el: "Άγνωστο" },

  // ——— BTC regime ———————————————————————————————————————————————————————
  btcRegime: { en: "BTC regime", el: "Καθεστώς BTC" },
  bull: { en: "bull", el: "ανοδικό" },
  // Split either side of the two bold numbers rather than interpolated, so the
  // numbers keep their own mono styling in the markup.
  weeklyClosePre: { en: "Weekly close ", el: "Εβδομαδιαίο κλείσιμο " },
  weeklyCloseMid: { en: " vs 50-week average ", el: " έναντι μέσου όρου 50 εβδομάδων " },
  masterSwitch: {
    en: "The master switch: new picks only while BTC is bullish.",
    el: "Ο κεντρικός διακόπτης: νέες επιλογές μόνο όσο το BTC είναι ανοδικό.",
  },

  // ——— Alt-season gauge —————————————————————————————————————————————————
  altSeasonGauge: { en: "Alt-season gauge", el: "Δείκτης alt-season" },
  gaugeAria: { en: (n) => `Gauge reading ${n} of 100`, el: (n) => `Ένδειξη δείκτη ${n} από 100` },
  btcLeading: { en: "BTC leading", el: "Ηγείται το BTC" },
  altsLeading: { en: "Alts leading", el: "Ηγούνται τα alts" },
  gaugeShares: {
    en: (s30, sample, s200) => `${s30}% of the top ${sample} beat BTC over 30 days, ${s200}% over 200 days. `,
    el: (s30, sample, s200) => `${s30}% από τα ${sample} μεγαλύτερα ξεπέρασαν το BTC στις 30 ημέρες, ${s200}% στις 200 ημέρες. `,
  },
  altSeasonIs: { en: "Alt season is when 75%+ do.", el: "Alt season είναι όταν το κάνει 75%+." },
  "ALT SEASON": { en: "alt season", el: "alt season" },
  "ALTS LEADING": { en: "alts leading", el: "ηγούνται τα alts" },
  MIXED: { en: "mixed", el: "μικτό" },
  "BTC SEASON": { en: "btc season", el: "btc season" },

  // ——— Funnel ———————————————————————————————————————————————————————————
  todaysFunnel: { en: "Today's funnel", el: "Το χωνί της ημέρας" },
  funnelUniverse: { en: "Coins scanned", el: "Νομίσματα που σαρώθηκαν" },
  funnelGated: { en: "Liquid and on Binance", el: "Ρευστά και διαθέσιμα στη Binance" },
  funnelWatchlist: { en: "Passed all vetoes → watchlist", el: "Πέρασαν όλα τα βέτο → λίστα παρακολούθησης" },
  funnelEligible: { en: "Met the pick rule", el: "Πληρούν τον κανόνα επιλογής" },
  funnelPicked: { en: "Picked today → test buy", el: "Επιλέχθηκαν σήμερα → δοκιμαστική αγορά" },

  // ——— Test book —————————————————————————————————————————————————————————
  testBook: { en: "Test book", el: "Δοκιμαστικό χαρτοφυλάκιο" },
  paperWith: { en: (amount) => `paper · ${amount}`, el: (amount) => `εικονικά · ${amount}` },
  equity: { en: "Equity", el: "Κεφάλαιο" },
  sinceStart: { en: (p) => `${p} since start`, el: (p) => `${p} από την αρχή` },
  cashFree: { en: "Cash free", el: "Ελεύθερα μετρητά" },
  slotsUsed: { en: (used, max) => `${used} of ${max} slots used`, el: (used, max) => `${used} από ${max} θέσεις σε χρήση` },
  closedTrades: { en: "Closed trades", el: "Κλειστές συναλλαγές" },
  winRateAvg: {
    en: (wr, avgR) => `win rate ${wr}% · avg ${avgR}R`,
    el: (wr, avgR) => `ποσοστό επιτυχίας ${wr}% · μέσο ${avgR}R`,
  },
  beatBtc: { en: "Beat BTC", el: "Ξεπέρασαν το BTC" },
  ofClosedSameDays: { en: "of closed trades, same days", el: "των κλειστών συναλλαγών, ίδιες ημέρες" },
  thCoin: { en: "Coin", el: "Νόμισμα" },
  thOpened: { en: "Opened", el: "Άνοιξε" },
  thEntry: { en: "Entry", el: "Είσοδος" },
  thStop: { en: "Stop", el: "Stop" },
  thNow: { en: "Now", el: "Τώρα" },
  thResult: { en: "Result", el: "Αποτέλεσμα" },
  thBtcSameDays: { en: "BTC same days", el: "BTC ίδιες ημέρες" },
  thVsBtc: { en: "vs BTC", el: "έναντι BTC" },
  thWhyPicked: { en: "Why picked", el: "Γιατί επιλέχθηκε" },
  thClosed: { en: "Closed", el: "Έκλεισε" },
  thExit: { en: "Exit", el: "Έξοδος" },
  thR: { en: "R", el: "R" },
  thExitReason: { en: "Exit reason", el: "Λόγος εξόδου" },
  isNew: { en: "new", el: "νέο" },
  noOpenPositions: { en: "No open test positions. ", el: "Καμία ανοιχτή δοκιμαστική θέση. " },
  pickNeedsRules: {
    en: "A pick needs a coin that clears every rule below.",
    el: "Για μια επιλογή χρειάζεται νόμισμα που περνά όλους τους κανόνες παρακάτω.",
  },
  waitingForRegime: {
    en: "Waiting for BTC's weekly regime to turn bullish.",
    el: "Αναμονή να γίνει ανοδικό το εβδομαδιαίο καθεστώς του BTC.",
  },

  // ——— Watchlist ————————————————————————————————————————————————————————
  watchlist: { en: "Watchlist", el: "Λίστα παρακολούθησης" },
  clickCoin: { en: "Click a coin to open its card", el: "Πάτα ένα νόμισμα για να ανοίξει η καρτέλα του" },
  thStrength: { en: "Strength", el: "Ισχύς" },
  thQuality: { en: "Quality", el: "Ποιότητα" },
  thSupplyRisk: { en: "Supply risk", el: "Κίνδυνος προσφοράς" },
  thStatus: { en: "Status", el: "Κατάσταση" },
  trending: { en: "trending", el: "σε τάση" },
  pickedToday: { en: "Picked today", el: "Επιλέχθηκε σήμερα" },
  eligible: { en: "Eligible", el: "Επιλέξιμο" },

  // ——— Rejects ——————————————————————————————————————————————————————————
  rejectedByVetoes: { en: "Rejected by vetoes", el: "Απορρίφθηκαν από τα βέτο" },
  hide: { en: "Hide", el: "Απόκρυψη" },
  showN: { en: (n) => `Show ${n}`, el: (n) => `Εμφάνιση ${n}` },
  thWhyRejected: { en: "Why rejected", el: "Γιατί απορρίφθηκε" },

  // ——— News radar ———————————————————————————————————————————————————————
  newsRadar: { en: "News radar", el: "Ραντάρ ειδήσεων" },
  updatedAgo: { en: (when) => `updated ${when}`, el: (when) => `ενημερώθηκε ${when}` },
  noNewsForGrades: {
    en: "No news items for the selected grades.",
    el: "Δεν υπάρχουν ειδήσεις για τις επιλεγμένες βαθμίδες.",
  },

  // ——— Footer ———————————————————————————————————————————————————————————
  sources: { en: "Sources", el: "Πηγές" },
  healthCandles: { en: "Candles", el: "Κεριά" },
  healthClaude: { en: "Claude explainers", el: "Επεξηγήσεις Claude" },
  healthNews: { en: (ok, total) => `News ${ok}/${total} feeds`, el: (ok, total) => `Ειδήσεις ${ok}/${total} ροές` },
  twitterOff: { en: "X/Twitter not connected", el: "X/Twitter μη συνδεδεμένο" },
  healthOk: { en: "ok", el: "ok" },
  healthOff: { en: "off", el: "εκτός" },
  baseRateLabel: { en: "Base rate:", el: "Βασικό ποσοστό:" },
  baseRateBody: {
    en: "most altcoins underperform BTC over a full cycle and many go to zero. The Scout raises the odds and screens out known blow-up patterns. Judge it by the journal after 3–6 months, not by single picks.",
    el: "τα περισσότερα altcoins υστερούν έναντι του BTC σε έναν πλήρη κύκλο και πολλά πάνε στο μηδέν. Ο Scout βελτιώνει τις πιθανότητες και φιλτράρει γνωστά μοτίβα κατάρρευσης. Κρίνε τον από το ημερολόγιο μετά 3–6 μήνες, όχι από μεμονωμένες επιλογές.",
  },

  // ——— Coin card ————————————————————————————————————————————————————————
  deepDive: { en: "Coin deep-dive card", el: "Καρτέλα ανάλυσης νομίσματος" },
  tierRadar: { en: "Radar", el: "Ραντάρ" },
  tierWatchlist: { en: "Watchlist", el: "Λίστα" },
  tierReject: { en: "Reject", el: "Απόρριψη" },
  tierPicked: { en: "Picked", el: "Επιλεγμένο" },
  tierEligible: { en: "Watchlist · eligible", el: "Λίστα · επιλέξιμο" },
  notPicked: { en: "NOT PICKED", el: "ΔΕΝ ΕΠΙΛΕΧΘΗΚΕ" },
  narrativeHeat: { en: "Narrative heat", el: "Θερμότητα αφηγήματος" },
  relativeStrength: { en: "Relative strength", el: "Σχετική ισχύς" },
  quality: { en: "Quality", el: "Ποιότητα" },
  supplyRiskLower: { en: "Supply risk (lower is better)", el: "Κίνδυνος προσφοράς (χαμηλότερο = καλύτερο)" },
  whatItIs: { en: "What it is", el: "Τι είναι" },
  projectDescription: { en: "project description", el: "περιγραφή project" },
  noExplainer: {
    en: "No description fetched yet. Explainers are made for new picks and the top five of the watchlist.",
    el: "Δεν έχει ανακτηθεί περιγραφή ακόμη. Επεξηγήσεις γράφονται για τις νέες επιλογές και τα πέντε πρώτα της λίστας.",
  },
  homepage: { en: "Homepage", el: "Ιστοσελίδα" },
  whitepaper: { en: "Whitepaper", el: "Whitepaper" },
  categoriesLabel: { en: (list) => `Categories: ${list}`, el: (list) => `Κατηγορίες: ${list}` },
  tokenEconomics: { en: "Token economics", el: "Οικονομικά του token" },
  marketCap: { en: "Market cap", el: "Κεφαλαιοποίηση" },
  fdv: { en: "Fully diluted value", el: "Πλήρως απομειωμένη αξία (FDV)" },
  fdvOverMcap: { en: "FDV ÷ market cap", el: "FDV ÷ κεφαλαιοποίηση" },
  circulatingShare: { en: "Circulating share of supply", el: "Ποσοστό προσφοράς σε κυκλοφορία" },
  unlockSchedule: { en: "Unlock schedule", el: "Χρονοδιάγραμμα αποδέσμευσης" },
  notConnectedYet: { en: "not connected yet", el: "μη συνδεδεμένο ακόμη" },
  liquidityAndTrend: { en: "Liquidity and trend", el: "Ρευστότητα και τάση" },
  price: { en: "Price", el: "Τιμή" },
  volumeShare: { en: "24h volume (share of market cap)", el: "Όγκος 24ω (ως ποσοστό κεφαλαιοποίησης)" },
  bidDepth: { en: "Bid depth within 2%", el: "Βάθος αγορών εντός 2%" },
  above50d: { en: "Above 50-day average", el: "Πάνω από τον μέσο όρο 50 ημερών" },
  yes: { en: "yes", el: "ναι" },
  no: { en: "no", el: "όχι" },
  sevenDayMove: { en: "7-day move", el: "Κίνηση 7 ημερών" },
  stretchAbove20d: { en: "Stretch above 20-day average", el: "Απόσταση πάνω από τον μέσο όρο 20 ημερών" },
  vsBtcAndNews: { en: "vs BTC and news", el: "Έναντι BTC και ειδήσεις" },
  sevenDays: { en: "7 days", el: "7 ημέρες" },
  thirtyDays: { en: "30 days", el: "30 ημέρες" },
  twoHundredDays: { en: "200 days", el: "200 ημέρες" },
  newsMentions7d: { en: "News mentions, 7 days", el: "Αναφορές σε ειδήσεις, 7 ημέρες" },

  // ——— Reading guide ————————————————————————————————————————————————————
  guideTitle: { en: "How to read this page", el: "Πώς να διαβάζεις αυτή τη σελίδα" },
  guideOpen: { en: "Open the guide", el: "Άνοιγμα οδηγού" },
  guideClose: { en: "Close the guide", el: "Κλείσιμο οδηγού" },
};

/**
 * The reading guide: what the page is, where the numbers come from, how they
 * get ranked, and what it can't tell you. Each section is a heading plus
 * paragraphs or term/definition pairs, so it renders with the panel styles
 * already on the page.
 */
export const SCOUT_GUIDE = {
  en: [
    {
      h: "What this page is",
      p: [
        "The Scout does not forecast prices. It looks for which narratives — themed baskets of coins, like AI or real-world assets — money is rotating into right now, builds a watchlist from them, and buys the single best candidate with paper money so the system can be judged by its own journal instead of by memory.",
        "Nothing on this page places an order or touches a real account.",
      ],
    },
    {
      h: "Where the numbers come from",
      p: [
        "A job on a Mac mini does the work and publishes a snapshot; this page only reads it. The full market scan runs once a day after the UTC daily close, and the news feeds refresh every hour. That is why the numbers do not move while you watch — the timestamp under the title tells you how old they are, and Reload checks for a newer snapshot.",
      ],
      dl: [
        ["CoinGecko", "the coin universe, market cap, 24h volume, circulating and total supply, and the hottest categories."],
        ["Binance", "prices, daily candles for the trend measures, and order-book depth within 2% of the price."],
        ["BTC weekly close", "the regime switch: this week's close against the 50-week average."],
        ["News feeds", "public RSS, graded A/B/C by how market-moving the source and wording look."],
        ["Claude", "the plain-language \"What it is\" paragraph, written for new picks and the top five of the watchlist."],
      ],
      after: "The Sources line in the footer says whether each one answered on the last run. If a source is off, the affected columns show – rather than a stale guess.",
    },
    {
      h: "How a coin gets ranked",
      p: ["Ranking runs in three stages, and each one can only remove coins."],
      dl: [
        ["1. Gates", "a coin must be large and liquid enough to trade, and tradeable on Binance. Everything else is dropped before scoring."],
        ["2. Vetoes", "hard disqualifications, no matter how good the rest looks: a market cap far below the fully diluted value (tokens still waiting to unlock), very little of the supply actually circulating, volume so large against market cap that it reads as a frenzy, a thin order book, or a price already stretched far above its own 20-day average. Rejected by vetoes lists them with the reason."],
        ["3. Four scores, 0–100", "every surviving coin gets scored, and the top of the ranking becomes the watchlist."],
        ["Narrative heat", "how hot the coin's basket is, plus a bonus for trending and for recent news mentions."],
        ["Relative strength", "its 7, 30 and 200-day performance against BTC, ranked against the rest of today's field — so 70 means it beat roughly 70% of the field, not that it rose 70%."],
        ["Quality", "size and traded volume, plus how much of the supply is already circulating."],
        ["Supply risk", "lower is better: how much supply is still locked up and waiting to arrive."],
      ],
      after: "The four are combined into one pick score that sets the order of the watchlist. Then the mechanical pick rule decides whether anything is actually bought: BTC's weekly regime must be bullish, heat and strength must clear their minimums, and the coin must be above its own 50-day average. The Status column shows either Eligible or the first rule it failed.",
    },
    {
      h: "Reading each panel",
      dl: [
        ["Narrative rotation board", "one row per basket, coloured by performance against BTC. Green means the basket is beating BTC over that window, red means it is losing to it. Breadth is the share of the basket beating BTC over 30 days — high breadth means the whole theme is moving, low breadth means one coin is carrying it, which the row flags."],
        ["Stage", "where the rotation is in its life: Accelerating is winning on both 7 and 30 days, Mainstream is still winning but already far ahead over 200 days (late), Exhausting is up over 30 days but rolling over on 7."],
        ["BTC regime", "the master switch. While it is not bullish, no new paper positions are opened at all."],
        ["Alt-season gauge", "the share of large coins beating BTC. Above 75 is an alt season; low readings mean money is sitting in BTC."],
        ["Today's funnel", "how many coins survived each stage, from the whole scan down to what was actually bought."],
        ["Test book", "the paper account. Equity is what the account is worth, R is the result measured in units of the risk taken, and BTC same days compares each trade against simply holding BTC over the identical dates."],
        ["News radar", "A is the most market-moving grade, C the least; the A/B/C buttons filter the feed."],
      ],
    },
    {
      h: "What it cannot tell you",
      p: [
        "Most altcoins lose to BTC over a full cycle and many go to zero. The Scout improves the odds and screens out known blow-up patterns; it does not remove the risk. Judge it from the test book after three to six months, not from a single pick, and treat it as research rather than advice.",
      ],
    },
  ],
  el: [
    {
      h: "Τι είναι αυτή η σελίδα",
      p: [
        "Ο Scout δεν προβλέπει τιμές. Ψάχνει προς ποια αφηγήματα — θεματικά καλάθια νομισμάτων, όπως AI ή real-world assets — μετακινείται το χρήμα αυτή τη στιγμή, φτιάχνει από αυτά μια λίστα παρακολούθησης και αγοράζει τον καλύτερο υποψήφιο με εικονικά χρήματα, ώστε το σύστημα να κρίνεται από το ημερολόγιό του και όχι από εντυπώσεις.",
        "Τίποτα σε αυτή τη σελίδα δεν στέλνει εντολή και δεν αγγίζει πραγματικό λογαριασμό.",
      ],
    },
    {
      h: "Από πού έρχονται τα νούμερα",
      p: [
        "Μια εργασία σε ένα Mac mini κάνει τη δουλειά και δημοσιεύει ένα στιγμιότυπο· η σελίδα απλώς το διαβάζει. Η πλήρης σάρωση της αγοράς τρέχει μία φορά την ημέρα μετά το ημερήσιο κλείσιμο UTC, και οι ροές ειδήσεων ανανεώνονται κάθε ώρα. Γι' αυτό τα νούμερα δεν κινούνται όσο τα βλέπεις — η χρονοσήμανση κάτω από τον τίτλο δείχνει πόσο παλιά είναι, και η Ανανέωση ελέγχει για νεότερο στιγμιότυπο.",
      ],
      dl: [
        ["CoinGecko", "το σύνολο των νομισμάτων, η κεφαλαιοποίηση, ο όγκος 24ω, η προσφορά σε κυκλοφορία και η συνολική, και οι πιο θερμές κατηγορίες."],
        ["Binance", "τιμές, ημερήσια κεριά για τους δείκτες τάσης, και βάθος βιβλίου εντολών εντός 2% της τιμής."],
        ["Εβδομαδιαίο κλείσιμο BTC", "ο διακόπτης καθεστώτος: το κλείσιμο της εβδομάδας έναντι του μέσου όρου 50 εβδομάδων."],
        ["Ροές ειδήσεων", "δημόσια RSS, βαθμολογημένα A/B/C ανάλογα με το πόσο επηρεάζουν την αγορά η πηγή και η διατύπωση."],
        ["Claude", "η παράγραφος «Τι είναι» σε απλή γλώσσα, γραμμένη για τις νέες επιλογές και τα πέντε πρώτα της λίστας."],
      ],
      after: "Η γραμμή «Πηγές» στο υποσέλιδο δείχνει αν κάθε πηγή απάντησε στην τελευταία εκτέλεση. Όταν μια πηγή είναι εκτός, οι στήλες που εξαρτώνται από αυτή δείχνουν – αντί για παλιά εκτίμηση.",
    },
    {
      h: "Πώς ταξινομείται ένα νόμισμα",
      p: ["Η ταξινόμηση γίνεται σε τρία στάδια, και κάθε στάδιο μπορεί μόνο να αφαιρεί νομίσματα."],
      dl: [
        ["1. Πύλες", "το νόμισμα πρέπει να είναι αρκετά μεγάλο και ρευστό για να μπορεί να διαπραγματευτεί, και διαθέσιμο στη Binance. Ό,τι δεν περνά, φεύγει πριν τη βαθμολόγηση."],
        ["2. Βέτο", "απόλυτοι αποκλεισμοί, όσο καλά και να δείχνουν τα υπόλοιπα: κεφαλαιοποίηση πολύ μικρότερη από την πλήρως απομειωμένη αξία (tokens που περιμένουν ακόμη να αποδεσμευτούν), πολύ μικρό μέρος της προσφοράς πραγματικά σε κυκλοφορία, όγκος τόσο μεγάλος σε σχέση με την κεφαλαιοποίηση που δείχνει υστερία, ρηχό βιβλίο εντολών, ή τιμή που έχει ήδη απομακρυνθεί πολύ πάνω από τον δικό της μέσο όρο 20 ημερών. Η ενότητα «Απορρίφθηκαν από τα βέτο» τα δείχνει με τον λόγο."],
        ["3. Τέσσερα σκορ, 0–100", "κάθε νόμισμα που επιβιώνει βαθμολογείται, και η κορυφή της κατάταξης γίνεται η λίστα παρακολούθησης."],
        ["Θερμότητα αφηγήματος", "πόσο θερμό είναι το καλάθι του νομίσματος, συν πρόσθετο βάρος αν είναι σε τάση και αν έχει πρόσφατες αναφορές σε ειδήσεις."],
        ["Σχετική ισχύς", "η απόδοσή του σε 7, 30 και 200 ημέρες έναντι του BTC, κατατεταγμένη απέναντι στα υπόλοιπα νομίσματα της ημέρας — άρα 70 σημαίνει ότι ξεπέρασε περίπου το 70% του πεδίου, όχι ότι ανέβηκε 70%."],
        ["Ποιότητα", "μέγεθος και όγκος συναλλαγών, συν πόσο από την προσφορά βρίσκεται ήδη σε κυκλοφορία."],
        ["Κίνδυνος προσφοράς", "χαμηλότερο = καλύτερο: πόση προσφορά είναι ακόμη δεσμευμένη και περιμένει να φτάσει."],
      ],
      after: "Τα τέσσερα συνδυάζονται σε ένα σκορ επιλογής που καθορίζει τη σειρά της λίστας. Μετά ο μηχανικός κανόνας επιλογής αποφασίζει αν θα αγοραστεί πράγματι κάτι: το εβδομαδιαίο καθεστώς του BTC πρέπει να είναι ανοδικό, η θερμότητα και η ισχύς πρέπει να περάσουν τα ελάχιστα όριά τους, και το νόμισμα πρέπει να είναι πάνω από τον δικό του μέσο όρο 50 ημερών. Η στήλη «Κατάσταση» δείχνει είτε «Επιλέξιμο» είτε τον πρώτο κανόνα που δεν πέρασε.",
    },
    {
      h: "Πώς διαβάζεται κάθε πίνακας",
      dl: [
        ["Πίνακας εναλλαγής αφηγημάτων", "μία γραμμή για κάθε καλάθι, χρωματισμένη με βάση την απόδοση έναντι του BTC. Το πράσινο σημαίνει ότι το καλάθι ξεπερνά το BTC σε αυτό το διάστημα, το κόκκινο ότι υστερεί. Το «Εύρος» είναι το ποσοστό του καλαθιού που ξεπερνά το BTC στις 30 ημέρες — μεγάλο εύρος σημαίνει ότι κινείται όλη η θεματική, μικρό εύρος σημαίνει ότι ένα νόμισμα το κρατά μόνο του, κάτι που η γραμμή επισημαίνει."],
        ["Στάδιο", "σε ποιο σημείο της ζωής του βρίσκεται η εναλλαγή: «Επιταχύνεται» = κερδίζει και στις 7 και στις 30 ημέρες, «Καθιερωμένο» = κερδίζει ακόμη αλλά έχει προηγηθεί πολύ στις 200 ημέρες (αργά), «Εξαντλείται» = ανοδικό στις 30 ημέρες αλλά γυρίζει στις 7."],
        ["Καθεστώς BTC", "ο κεντρικός διακόπτης. Όσο δεν είναι ανοδικό, δεν ανοίγει καμία νέα εικονική θέση."],
        ["Δείκτης alt-season", "το ποσοστό των μεγάλων νομισμάτων που ξεπερνούν το BTC. Πάνω από 75 είναι alt season· χαμηλές τιμές σημαίνουν ότι το χρήμα κάθεται στο BTC."],
        ["Το χωνί της ημέρας", "πόσα νομίσματα επιβίωσαν σε κάθε στάδιο, από όλη τη σάρωση μέχρι ό,τι αγοράστηκε τελικά."],
        ["Δοκιμαστικό χαρτοφυλάκιο", "ο εικονικός λογαριασμός. «Κεφάλαιο» είναι η αξία του λογαριασμού, «R» είναι το αποτέλεσμα μετρημένο σε μονάδες του ρίσκου που αναλήφθηκε, και «BTC ίδιες ημέρες» συγκρίνει κάθε συναλλαγή με το να κρατούσες απλώς BTC τις ίδιες ακριβώς ημερομηνίες."],
        ["Ραντάρ ειδήσεων", "το A είναι η βαθμίδα με τη μεγαλύτερη επίδραση στην αγορά, το C η μικρότερη· τα κουμπιά A/B/C φιλτράρουν τη ροή."],
      ],
    },
    {
      h: "Τι δεν μπορεί να σου πει",
      p: [
        "Τα περισσότερα altcoins υστερούν έναντι του BTC σε έναν πλήρη κύκλο και πολλά πάνε στο μηδέν. Ο Scout βελτιώνει τις πιθανότητες και φιλτράρει γνωστά μοτίβα κατάρρευσης· δεν εξαλείφει τον κίνδυνο. Κρίνε τον από το δοκιμαστικό χαρτοφυλάκιο μετά από τρεις έως έξι μήνες, όχι από μία επιλογή, και αντιμετώπισέ τον ως έρευνα και όχι ως επενδυτική συμβουλή.",
      ],
    },
  ],
};

/**
 * The snapshot carries its reasons as English sentences built on the Mac
 * (vetoReasons, rankPicks, openBlockers, exitReason). Re-publishing them per
 * language would mean teaching the job about languages, so instead they are
 * rewritten here: each rule is a pattern plus the Greek phrasing, numbers kept
 * as captured. Anything that doesn't match is passed through untouched, which
 * is the right failure — an English reason still reads as a reason.
 */
const REASON_RULES_EL = [
  [/^FDV (.+)× market cap \(supply overhang\)$/, (m) => `FDV ${m[1]}× της κεφαλαιοποίησης (πλεόνασμα προσφοράς)`],
  [/^only (\d+)% of supply circulating$/, (m) => `μόνο ${m[1]}% της προσφοράς σε κυκλοφορία`],
  [/^volume (.+)× market cap \(frenzy\/wash\)$/, (m) => `όγκος ${m[1]}× της κεφαλαιοποίησης (υστερία/εικονικός)`],
  [/^EXTENDED — watch, don't chase$/, () => "ΥΠΕΡΕΚΤΑΜΕΝΟ — παρακολούθησε, μην το κυνηγάς"],
  [/^thin order book \((.+) bids within 2%\)$/, (m) => `ρηχό βιβλίο εντολών (${m[1]} αγορές εντός 2%)`],
  [/^BTC regime not bullish$/, () => "το καθεστώς του BTC δεν είναι ανοδικό"],
  [/^heat (\d+) < (\d+)$/, (m) => `θερμότητα ${m[1]} < ${m[2]}`],
  [/^strength (\d+) < (\d+)$/, (m) => `ισχύς ${m[1]} < ${m[2]}`],
  [/^below its 50-day average$/, () => "κάτω από τον μέσο όρο 50 ημερών του"],
  [/^no daily price history$/, () => "δεν υπάρχει ημερήσιο ιστορικό τιμών"],
  [/^already (\d+) open test positions$/, (m) => `υπάρχουν ήδη ${m[1]} ανοιχτές δοκιμαστικές θέσεις`],
  [/^already picked today$/, () => "έχει γίνει ήδη επιλογή σήμερα"],
  [/^not enough test cash$/, () => "δεν υπάρχουν αρκετά δοκιμαστικά μετρητά"],
  [/^already holding$/, () => "υπάρχει ήδη στο χαρτοφυλάκιο"],
  [/^cooldown after exit \((\d+)d\)$/, (m) => `αναμονή μετά την έξοδο (${m[1]} ημ)`],
  [/^no opening price yet$/, () => "δεν υπάρχει ακόμη τιμή ανοίγματος"],
  [/^stop hit$/, () => "ενεργοποιήθηκε το stop"],
  [/^gapped through stop$/, () => "κενό (gap) κάτω από το stop"],
  // The pick reason: "heat 72, strength 81, quality 64, supply risk 30 · ai, gaming".
  // The narrative keys after the "·" are basket ids and stay as they are.
  [/^heat (\d+), strength (\d+), quality (\d+), supply risk (\d+)(.*)$/,
    (m) => `θερμότητα ${m[1]}, ισχύς ${m[2]}, ποιότητα ${m[3]}, κίνδυνος προσφοράς ${m[4]}${m[5]}`],
];

/** Translates one snapshot reason string. `reasons` handles a joined list. */
export function translateReason(text, lang) {
  if (lang !== "el" || !text) return text;
  for (const [re, make] of REASON_RULES_EL) {
    const m = re.exec(text);
    if (m) return make(m);
  }
  return text;
}

/**
 * Translates an array of reasons and joins it the way the tables expect.
 *
 * The separator is per-language on purpose: a semicolon is the question mark in
 * Greek, so "already picked today; already holding" would read as a question.
 */
export function translateReasons(list, lang, sep = lang === "el" ? " · " : "; ") {
  return (list || []).map((r) => translateReason(r, lang)).join(sep);
}
