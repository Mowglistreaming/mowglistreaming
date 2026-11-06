// Adaptation publique de partage.js : lecture ouverte, envoi réservé aux comptes connectés dans cloud.js.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://rjrqsetpidalljzveknl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nQrqlpgu-I6QoAUVnGpiAw_2fzjbryN";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const audioBucket = supabase.storage.from("mowgli-audio");

await window.__mowgliReady;
const state = window.__mowgliLocal();

async function loadSharedMusic() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id || null;
  const { data: rows, error } = await supabase
    .from("tracks")
    .select("id,title,artist,audio_url,cover_url,duration_seconds,created_at,created_by")
    .eq("is_public", true)
    .order("created_at", { ascending: true });
  if (error) throw error;

  for (const row of rows || []) {
    let track = state.T.find((item) => item.cloud_id === row.id);
    if (track) {
      track.publicShared = row.created_by !== userId;
      continue;
    }
    if (!row.audio_url) continue;
    const { data: blob, error: downloadError } = await audioBucket.download(row.audio_url);
    if (downloadError) {
      console.warn("Piste publique indisponible :", row.title, downloadError.message);
      continue;
    }
    track = {
      id: "shared-" + row.id,
      cloud_id: row.id,
      publicShared: true,
      title: row.title,
      artist: row.artist || "Inconnu",
      d: row.duration_seconds || 0,
      at: Date.parse(row.created_at) || Date.now(),
      img: row.cover_url || undefined,
      blob,
    };
    state.T.push(track);
    await state.store("readwrite", (store) => store.put(track));
  }
  state.T.sort((a, b) => a.at - b.at);
  state.render();
}

loadSharedMusic().catch((error) => console.error("Catalogue partagé indisponible :", error));
window.addEventListener("mowgli:shared-updated", () => {
  loadSharedMusic().catch((error) => console.error("Actualisation du catalogue partagé impossible :", error));
});
