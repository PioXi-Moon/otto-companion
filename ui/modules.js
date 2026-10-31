import { AmbientMusicEngine, speakEnglish } from "./music.js";

const $ = (selector) => document.querySelector(selector);

function mmss(total) {
  const n = Math.max(0, Number(total) || 0);
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

function cleanMeaning(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function createModulesUI({ post, toast, goto, petAction, getPetName }) {
  const engine = new AmbientMusicEngine();
  let snapshot = null;
  let currentDeck = null;
  let words = [];
  let activeMood = "全部";
  let searchTimer = null;
  let elapsedTimer = null;
  let volumeTimer = null;
  let initDone = false;

  engine.onState = ({ status, track }) => {
    if (!snapshot) return;
    if (status === "playing") {
      snapshot.music.status = "playing";
      snapshot.music.trackId = track?.id ?? snapshot.music.trackId;
      snapshot.music.currentTrack = track ?? snapshot.music.currentTrack;
    } else if (status === "paused") {
      snapshot.music.status = "paused";
    } else if (status === "stopped") {
      snapshot.music.status = "stopped";
    }
    renderMusic();
  };

  function bind() {
    if (initDone) return;
    initDone = true;
    $("#musicPlay")?.addEventListener("click", togglePlay);
    $("#musicStop")?.addEventListener("click", () => run("music_stop"));
    $("#musicNext")?.addEventListener("click", () => run("music_next"));
    $("#musicPrev")?.addEventListener("click", prevTrack);
    $("#musicVolume")?.addEventListener("input", (event) => {
      const volume = Number(event.target.value) / 100;
      engine.setVolume(volume);
      if (snapshot) snapshot.music.volume = volume;
      clearTimeout(volumeTimer);
      volumeTimer = setTimeout(() => {
        fetch("/api/tools/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "music_volume", args: { volume }, source: "ui" }),
        }).catch(() => {});
      }, 180);
    });
    $("#startQuiz")?.addEventListener("click", () => run("word_quiz", {}, "words"));
    $("#wordAgain")?.addEventListener("click", () => markWord("again"));
    $("#wordKnownBtn")?.addEventListener("click", () => markWord("known"));
    $("#wordNext")?.addEventListener("click", () => run("word_next", {}, "words"));
    $("#wordRepeat")?.addEventListener("click", () => {
      const word = snapshot?.words?.session?.currentWord;
      if (!word) return;
      speakEnglish(word.word);
      petAction?.("listening");
    });
    $("#speakWord")?.addEventListener("click", () => {
      const word = snapshot?.words?.session?.currentWord;
      if (!word) return;
      if (!speakEnglish(word.word)) toast?.("当前系统没有可用的英文发音");
      petAction?.("studying");
    });
    $("#wordSearch")?.addEventListener("input", (event) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadWords(event.target.value), 220);
    });
    $("#quizOptions")?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-answer]");
      if (!btn) return;
      run("word_answer", { answer: btn.dataset.answer }, "words");
    });
    $("#wordLibrary")?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-word]");
      if (!card) return;
      run("word_show", { word: card.dataset.word }, "words");
    });
    elapsedTimer = setInterval(() => {
      updateMusicTime();
      renderEqualizer();
    }, 1000);
  }

  async function refresh() {
    bind();
    snapshot = await fetch("/api/modules").then((r) => r.json());
    currentDeck = snapshot?.words?.session?.deck ?? currentDeck;
    engine.setVolume(snapshot?.music?.volume ?? 0.46);
    renderMusic();
    renderWords();
    await loadWords($("#wordSearch")?.value ?? "");
    hydrateEngine();
  }

  async function loadWords(query = "") {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    else if (currentDeck) params.set("deck", currentDeck);
    words = await fetch(`/api/words?${params}`).then((r) => r.json()).then((r) => r.items ?? []);
    renderLibrary();
  }

  async function run(action, args = {}, tab = null) {
    const result = await post("/api/tools/run", { action, args, source: "ui" });
    if (result?.state?.currentTrack !== undefined) {
      snapshot.music = result.state;
      renderMusic();
      if (result.state.status === "playing" && !engine.isPlaying(result.state.currentTrack)) {
        await safePlay(result.state.currentTrack);
      }
    }
    if (action.startsWith("music_")) {
      petAction?.(action === "music_stop" ? "idle" : "content");
    }
    if (result?.word) {
      if (snapshot) snapshot.words.session.currentWord = result.word;
    }
    if (result?.stats && snapshot) snapshot.words.stats = result.stats;
    if (action.startsWith("word_") || action === "word_start") await refresh();
    if (result?.quiz && snapshot) {
      snapshot.words.session.quiz = result.quiz;
      renderQuiz();
    }
    if (tab && result?.ok) goto?.(tab);
    if (result?.spoken) toast?.(result.spoken);
    return result;
  }

  function renderMusic() {
    if (!snapshot?.music) return;
    const music = snapshot.music;
    const track = music.currentTrack;
    engine.setVolume(music.volume ?? 0.72);
    const cover = $("#musicCover");
    if (track) {
      cover?.style.setProperty("--music-a", track.accent);
      cover?.style.setProperty("--music-b", track.accent2);
      $("#musicSymbol").textContent = track.symbol;
      $("#musicTitle").textContent = track.title;
      $("#musicSubtitle").textContent = `${track.subtitle} · ${track.mood}`;
      $("#musicDuration").textContent = mmss(track.duration);
      document.title = music.status === "playing" ? `${track.title} · ${getPetName?.() ?? "Otto"}` : getPetName?.() ?? "Otto";
    } else {
      cover?.style.setProperty("--music-a", "#8a9288");
      cover?.style.setProperty("--music-b", "#e1ded4");
      $("#musicSymbol").textContent = "音";
      $("#musicTitle").textContent = "还没有播放";
      $("#musicSubtitle").textContent = "选一首，让房间里有一点声音。";
      $("#musicDuration").textContent = "--:--";
    }
    $("#musicPlay").textContent = music.status === "playing" ? "Ⅱ" : "▶";
    $("#musicPlay").classList.toggle("playing", music.status === "playing");
    $("#musicVolume").value = Math.round((music.volume ?? 0.46) * 100);
    $("#musicPlayer").classList.toggle("is-playing", music.status === "playing");
    renderTrackCards();
    renderFilters();
    updateMusicTime();
    renderEqualizer();
  }

  function renderFilters() {
    const box = $("#musicFilters");
    if (!box || !snapshot?.music?.tracks) return;
    const moods = ["全部", ...new Set(snapshot.music.tracks.map((track) => track.mood))];
    box.innerHTML = "";
    for (const mood of moods) {
      const button = document.createElement("button");
      button.textContent = mood;
      button.className = mood === activeMood ? "active" : "";
      button.addEventListener("click", () => {
        activeMood = mood;
        renderFilters();
        renderTrackCards();
      });
      box.appendChild(button);
    }
  }

  function renderTrackCards() {
    const box = $("#musicTracks");
    if (!box || !snapshot?.music?.tracks) return;
    box.innerHTML = "";
    for (const track of snapshot.music.tracks) {
      if (activeMood !== "全部" && track.mood !== activeMood) continue;
      const card = document.createElement("button");
      card.className = "track-card";
      card.classList.toggle("active", track.id === snapshot.music.trackId);
      card.style.setProperty("--track-a", track.accent);
      card.style.setProperty("--track-b", track.accent2);
      card.innerHTML = `
        <span class="track-mark"></span>
        <span class="track-copy"><b></b><em></em></span>
        <span class="track-meta"><i></i></span>`;
      card.querySelector(".track-mark").textContent = track.symbol;
      card.querySelector("b").textContent = track.title;
      card.querySelector("em").textContent = track.subtitle;
      card.querySelector(".track-meta i").textContent = track.mood;
      card.addEventListener("click", () => run("music_play", { track: track.id }, "music"));
      box.appendChild(card);
    }
  }

  async function togglePlay() {
    if (!snapshot) return;
    const music = snapshot.music;
    $("#musicError").classList.add("hidden");
    try {
      if (music.status === "playing") {
        engine.pause();
        await run("music_pause");
        return;
      }
      if (music.status === "paused" && music.currentTrack) {
        await engine.resume();
        await run("music_resume");
        return;
      }
      await run("music_play", { track: music.trackId ?? music.tracks?.[0]?.id }, "music");
    } catch {
      $("#musicError").classList.remove("hidden");
    }
  }

  async function prevTrack() {
    if (!snapshot?.music?.tracks?.length) return;
    const tracks = snapshot.music.tracks;
    const at = tracks.findIndex((track) => track.id === snapshot.music.trackId);
    const track = tracks[(Math.max(0, at) - 1 + tracks.length) % tracks.length];
    await run("music_play", { track: track.id }, "music");
  }

  async function safePlay(track) {
    if (!track) return;
    try {
      $("#musicError").classList.add("hidden");
      if (engine.isPlaying(track)) return;
      if (engine.track?.id === track.id && engine.paused) {
        await engine.resume();
        return;
      }
      await engine.play(track);
    } catch {
      $("#musicError").classList.remove("hidden");
    }
  }

  function hydrateEngine() {
    const music = snapshot?.music;
    if (!music) return;
    engine.setVolume(music.volume);
    if (music.status === "playing" && music.currentTrack) {
      if (!engine.track || engine.track.id !== music.currentTrack.id || !engine.isPlaying()) {
        safePlay(music.currentTrack);
      }
    }
  }

  function updateMusicTime() {
    const track = snapshot?.music?.currentTrack;
    if (!track) {
      $("#musicElapsed").textContent = "00:00";
      $("#musicProgress").style.width = "0%";
      return;
    }
    const elapsed = engine.isPlaying(track) || engine.track?.id === track.id ? engine.elapsedSeconds() : 0;
    const loopElapsed = elapsed % track.duration;
    $("#musicElapsed").textContent = mmss(loopElapsed);
    $("#musicProgress").style.width = `${Math.round((loopElapsed / track.duration) * 100)}%`;
  }

  function renderEqualizer() {
    $("#musicCover")?.classList.toggle("animating", snapshot?.music?.status === "playing");
  }

  function renderWords() {
    if (!snapshot?.words) return;
    const stats = snapshot.words.stats;
    $("#wordTotal").textContent = stats.total;
    $("#wordToday").textContent = stats.today;
    $("#wordKnown").textContent = stats.known;
    $("#wordMastery").textContent = `${stats.mastery}%`;
    $("#wordSeen").textContent = `看过 ${stats.seen} 个`;
    $("#wordToday").parentElement.classList.toggle("goal-done", stats.today >= stats.dailyGoal);

    const deckBox = $("#wordDecks");
    deckBox.innerHTML = "";
    for (const deck of snapshot.words.decks) {
      const button = document.createElement("button");
      button.className = deck.id === currentDeck ? "active" : "";
      button.innerHTML = "<b></b><span></span>";
      button.querySelector("b").textContent = deck.label;
      button.querySelector("span").textContent = `${deck.count} 词`;
      button.title = deck.description;
      button.addEventListener("click", () => {
        currentDeck = deck.id;
        run("word_start", { deck: deck.id }, "words");
      });
      deckBox.appendChild(button);
    }

    const word = snapshot.words.session.currentWord;
    const deck = snapshot.words.decks.find((item) => item.id === snapshot.words.session.deck);
    $("#flashDeck").textContent = deck?.label ?? "词卡";
    if (word) {
      $("#flashWord").textContent = word.word;
      $("#flashPhonetic").textContent = word.phonetic || "";
      $("#flashMeaning").textContent = cleanMeaning(word.meaning) || "暂时没有中文释义";
      $("#flashPos").textContent = word.pos || "";
      $("#flashLevel").textContent = word.level || "常用";
      $("#flashDefinition").textContent = word.definition || "";
      $("#flashcard").classList.toggle("is-known", word.progress?.status === "known");
    }
    renderQuiz();
  }

  function renderQuiz() {
    const quiz = snapshot?.words?.session?.quiz;
    const box = $("#quizOptions");
    if (!quiz) {
      $("#quizPrompt").textContent = "用当前单词做一道选择题。";
      box.innerHTML = "";
      $("#startQuiz").textContent = "出题";
      return;
    }
    $("#quizPrompt").textContent = `${quiz.word} 的中文意思是？`;
    box.innerHTML = "";
    for (const option of quiz.options) {
      const button = document.createElement("button");
      button.dataset.answer = option.word;
      button.textContent = option.meaning;
      box.appendChild(button);
    }
    $("#startQuiz").textContent = "换一题";
  }

  function renderLibrary() {
    const box = $("#wordLibrary");
    if (!box) return;
    if (!words.length) {
      box.innerHTML = `<p class="module-empty">没有搜到这个词，换个拼写或中文意思试试。</p>`;
      return;
    }
    box.innerHTML = "";
    for (const word of words) {
      const card = document.createElement("button");
      card.className = `word-cell ${word.progress?.status ?? "new"}`;
      card.dataset.word = word.word;
      card.innerHTML = `<b></b><span></span><em></em>`;
      card.querySelector("b").textContent = word.word;
      card.querySelector("span").textContent = cleanMeaning(word.meaning);
      card.querySelector("em").textContent =
        word.progress?.status === "known" ? "认识了" :
        word.progress?.status === "learning" ? `看过 ${word.progress.seen_count} 次` :
        word.pos || word.level || "";
      box.appendChild(card);
    }
  }

  async function markWord(result) {
    const word = snapshot?.words?.session?.currentWord;
    if (!word) return;
    await run("word_mark", { word: word.word, result }, "words");
    if (result === "known") await run("word_next", {}, "words");
  }

  async function handleEvent(event) {
    if (event.type === "music") {
      snapshot.music = event.state;
      renderMusic();
      if (event.state?.status === "playing") await safePlay(event.state.currentTrack);
      else if (event.state?.status === "paused") engine.pause();
      else if (event.state?.status === "stopped") engine.stop();
      return;
    }
    if (event.type === "module") {
      if (event.module === "words") {
        if (event.event === "start" && event.deck) currentDeck = event.deck;
        await refresh();
      } else if (event.module === "focus") {
        await refresh();
      }
      if (event.tab) {
        goto?.(event.tab);
        window.ottoPet?.openPanel?.();
      }
      return;
    }
    if (event.type === "navigate") {
      goto?.(event.tab);
      window.ottoPet?.openPanel?.();
    }
  }

  return {
    bind,
    refresh,
    handleEvent,
    run,
    destroy() {
      clearInterval(elapsedTimer);
      clearTimeout(volumeTimer);
      engine.stop();
    },
  };
}
