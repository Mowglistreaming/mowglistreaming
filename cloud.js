import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = "https://rjrqsetpidalljzveknl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nQrqlpgu-I6QoAUVnGpiAw_2fzjbryN";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const bucket = supabase.storage.from("mowgli-audio");
let currentUser = null;
const header = document.querySelector("header");
header.insertAdjacentHTML("beforeend", '<button class="chip" id="mowgli-cloud-open">☁ Synchronisation</button>');
document.body.insertAdjacentHTML("beforeend", '<div class="modal" id="mowgli-cloud-modal" hidden><div class="box" role="dialog" aria-label="Synchronisation cloud"><h3>Ma musique dans le cloud</h3><p class="keys">Connecte-toi avec un code envoyé à ton adresse e-mail. Les titres publiés sont visibles et écoutables par tous. Seuls les comptes connectés peuvent publier. Le forfait gratuit limite chaque fichier à 50 Mo.</p><label>Adresse e-mail<input type="email" id="mowgli-cloud-email" autocomplete="email" placeholder="toi@exemple.fr"></label><div style="display:flex;gap:8px"><button class="sm" id="mowgli-cloud-send">Envoyer un code</button><input type="text" id="mowgli-cloud-otp" inputmode="numeric" autocomplete="one-time-code" placeholder="Code reçu par e-mail" style="flex:1;min-width:0;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;color:var(--text);font:inherit"></div><div style="display:flex;gap:8px"><button class="btn" id="mowgli-cloud-verify" style="flex:1">Vérifier le code</button><button class="sm" id="mowgli-cloud-sync" disabled>Synchroniser</button></div><div id="mowgli-cloud-status" class="keys" role="status" aria-live="polite"></div><div class="acts"><button class="sm" id="mowgli-cloud-signout" hidden>Déconnexion</button><button class="sm" id="mowgli-cloud-close">Fermer</button></div></div></div>');
const modal = document.getElementById("mowgli-cloud-modal");
const status = document.getElementById("mowgli-cloud-status");
const setStatus = (message) => { status.textContent = message; };
const localState = () => window.__mowgliLocal();
function renderAuth(session) {
  currentUser = session?.user || null;
  const sync = document.getElementById("mowgli-cloud-sync");
  const signout = document.getElementById("mowgli-cloud-signout");
  sync.disabled = !currentUser;
  signout.hidden = !currentUser;
  document.getElementById("mowgli-cloud-open").textContent = currentUser ? "☁ Cloud connecté" : "☁ Synchronisation";
  if (currentUser) setStatus("Connecté : " + currentUser.email + ". Tu peux synchroniser ta bibliothèque.");
}
await window.__mowgliReady;
const { data: sessionData } = await supabase.auth.getSession();
renderAuth(sessionData.session);
supabase.auth.onAuthStateChange((_event, session) => renderAuth(session));
document.getElementById("mowgli-cloud-open").onclick = () => { modal.hidden = false; };
document.getElementById("mowgli-cloud-close").onclick = () => { modal.hidden = true; };
modal.onclick = (event) => { if (event.target === modal) modal.hidden = true; };
document.getElementById("mowgli-cloud-send").onclick = async () => {
  const email = document.getElementById("mowgli-cloud-email").value.trim();
  if (!email) { setStatus("Entre d’abord ton adresse e-mail."); return; }
  setStatus("Envoi du code…");
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  setStatus(error ? "Erreur : " + error.message : "Code envoyé. Regarde ta boîte e-mail puis saisis le code ici.");
};
document.getElementById("mowgli-cloud-verify").onclick = async () => {
  const email = document.getElementById("mowgli-cloud-email").value.trim();
  const token = document.getElementById("mowgli-cloud-otp").value.trim();
  if (!email || !token) { setStatus("Entre ton adresse et le code reçu."); return; }
  setStatus("Vérification du code…");
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) { setStatus("Erreur : " + error.message); return; }
  renderAuth(data.session);
  setStatus("Connecté. Clique sur Synchroniser pour copier ta musique dans ton espace privé.");
};
document.getElementById("mowgli-cloud-signout").onclick = async () => {
  const { error } = await supabase.auth.signOut();
  setStatus(error ? "Erreur : " + error.message : "Déconnecté.");
};
async function syncLibrary() {
  if (!currentUser) { setStatus("Connecte-toi d’abord."); return; }
  await window.__mowgliReady;
  const state = localState();
  const userId = currentUser.id;
  let added = 0;
  setStatus("Récupération des morceaux…");
  const { data: remoteTracks, error: trackReadError } = await supabase.from("tracks").select("*").eq("created_by", userId);
  if (trackReadError) throw trackReadError;
  for (const row of remoteTracks || []) {
    let track = state.T.find((item) => item.cloud_id === row.id);
    if (!track && row.audio_url) {
      const { data: blob, error } = await bucket.download(row.audio_url);
      if (error) continue;
      track = { id: "cloud-" + row.id, cloud_id: row.id, title: row.title, artist: row.artist || "Inconnu", d: row.duration_seconds || 0, blob, at: Date.parse(row.created_at) || Date.now(), img: row.cover_url || undefined };
      state.T.push(track);
      await state.store("readwrite", (store) => store.put(track));
      added++;
    }
    if (track) track.cloud_id = row.id;
  }
  const cloudIds = new Set((remoteTracks || []).map((row) => row.id));
  for (const track of state.T) {
    if (track.publicShared) continue;
    if (!track.blob) continue;
    if (track.blob.size > 52428800) throw new Error("Le fichier « " + track.title + " » dépasse la limite gratuite de 50 Mo.");
    const cloudId = track.cloud_id || crypto.randomUUID();
    track.cloud_id = cloudId;
    const mime = track.blob.type || "audio/mpeg";
    const ext = ({"audio/mpeg":"mp3","audio/mp4":"m4a","audio/x-m4a":"m4a","audio/aac":"aac","audio/ogg":"ogg","audio/wav":"wav","audio/flac":"flac"})[mime] || "audio";
    const path = userId + "/" + cloudId + "." + ext;
    if (!cloudIds.has(cloudId)) {
      const { error: uploadError } = await bucket.upload(path, track.blob, { upsert: true, contentType: mime });
      if (uploadError) throw uploadError;
    }
    const { error: saveError } = await supabase.from("tracks").upsert({ id: cloudId, title: track.title, artist: track.artist || "Inconnu", album: null, audio_url: path, cover_url: track.img || null, duration_seconds: Math.round(track.d || 0), is_public: true, created_by: userId }, { onConflict: "id" });
    if (saveError) throw saveError;
    await state.store("readwrite", (store) => store.put(track));
  }
  setStatus("Synchronisation des playlists et des favoris…");
  const { data: remotePlaylists, error: playlistReadError } = await supabase.from("playlists").select("*").eq("owner_id", userId);
  if (playlistReadError) throw playlistReadError;
  for (const row of remotePlaylists || []) {
    let playlist = state.PLs.find((item) => item.cloud_id === row.id);
    if (!playlist) {
      playlist = { id: "p" + row.id, cloud_id: row.id, name: row.name, ids: [] };
      state.PLs.push(playlist);
      added++;
    } else {
      playlist.name = row.name;
    }
    const { data: items, error } = await supabase.from("playlist_tracks").select("track_id, position").eq("playlist_id", row.id).order("position");
    if (error) throw error;
    playlist.ids = (items || []).map((item) => state.T.find((track) => track.cloud_id === item.track_id)?.id).filter(Boolean);
  }
  const { data: remoteLikes, error: likeReadError } = await supabase.from("likes").select("track_id").eq("user_id", userId);
  if (likeReadError) throw likeReadError;
  for (const like of remoteLikes || []) {
    const track = state.T.find((item) => item.cloud_id === like.track_id);
    if (track) state.liked.add(track.id);
  }
  for (const playlist of state.PLs) {
    const playlistId = playlist.cloud_id || crypto.randomUUID();
    playlist.cloud_id = playlistId;
    const { error } = await supabase.from("playlists").upsert({ id: playlistId, owner_id: userId, name: playlist.name || "Playlist", is_public: false }, { onConflict: "id" });
    if (error) throw error;
    const { error: deleteError } = await supabase.from("playlist_tracks").delete().eq("playlist_id", playlistId);
    if (deleteError) throw deleteError;
    const items = playlist.ids.map((id, position) => ({ playlist_id: playlistId, track_id: state.T.find((track) => track.id === id)?.cloud_id, position })).filter((item) => item.track_id);
    if (items.length) {
      const { error: insertError } = await supabase.from("playlist_tracks").insert(items);
      if (insertError) throw insertError;
    }
  }
  const { error: clearLikesError } = await supabase.from("likes").delete().eq("user_id", userId);
  if (clearLikesError) throw clearLikesError;
  const likeRows = [...state.liked].map((id) => state.T.find((track) => track.id === id)?.cloud_id).filter(Boolean).map((id) => ({ user_id: userId, track_id: id }));
  if (likeRows.length) {
    const { error } = await supabase.from("likes").insert(likeRows);
    if (error) throw error;
  }
  state.saveP();
  state.saveL();
  state.render();
  window.dispatchEvent(new CustomEvent("mowgli:shared-updated"));
  setStatus("Synchronisation terminée : " + state.T.length + " morceau(x), " + state.PLs.length + " playlist(s). " + added + " élément(s) récupéré(s) du cloud.");
}
document.getElementById("mowgli-cloud-sync").onclick = async () => {
  const button = document.getElementById("mowgli-cloud-sync");
  button.disabled = true;
  try { await syncLibrary(); }
  catch (error) { setStatus("Synchronisation interrompue : " + (error?.message || String(error))); }
  finally { button.disabled = !currentUser; }
};
