import { useEffect, useState } from "react";
import { request } from "./api";
export function Keys({ close }: { close: () => void }) {
  const [status, setStatus] = useState<Record<string, boolean>>({}),
    [values, setValues] = useState<Record<string, string>>({}),
    [message, setMessage] = useState("");
  const refresh = () =>
    request<Record<string, boolean>>("/api/credentials").then(setStatus);
  useEffect(() => {
    void refresh().catch((e) => setMessage(String(e)));
  }, []);
  async function change(p: string, remove = false) {
    try {
      await request(
        `/api/credentials/${p}`,
        remove ? "DELETE" : "PUT",
        remove ? undefined : { key: values[p] },
      );
      setValues((v) => ({ ...v, [p]: "" }));
      await refresh();
      setMessage(
        "Préférence enregistrée. Les prochains appels utiliseront cette configuration.",
      );
    } catch (e) {
      setMessage(String(e));
    }
  }
  return (
    <section className="panel keys">
      <button onClick={close}>← Retour</button>
      <h1>Mes clés personnelles</h1>
      <p>
        Facultatif. Vous pouvez toujours attendre la reprise du service partagé.
        Votre clé sert uniquement à vos propres traitements, avec le même
        modèle.
      </p>
      {["gemini", "groq"].map((p) => (
        <section key={p}>
          <h2>
            {p === "gemini"
              ? "Google AI Studio · Gemini"
              : "Groq · transcription"}
          </h2>
          <p>{status[p] ? "Clé personnelle configurée" : "Service partagé"}</p>
          <label>
            Clé personnelle
            <input
              type="password"
              autoComplete="off"
              value={values[p] || ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [p]: e.target.value }))
              }
            />
          </label>
          <button disabled={!values[p]?.trim()} onClick={() => void change(p)}>
            Utiliser cette clé
          </button>
          {status[p] && (
            <button onClick={() => void change(p, true)}>
              Supprimer ma clé
            </button>
          )}
          <details>
            <summary>Comment obtenir une clé</summary>
            <p>
              Guide texte vérifié le 21 septembre 2026. La vidéo tutorielle n’a
              pas encore été fournie.
            </p>
            <ol>
              <li>
                Ouvrez{" "}
                {p === "gemini" ? (
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google AI Studio
                  </a>
                ) : (
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noreferrer"
                  >
                    la console Groq
                  </a>
                )}{" "}
                et connectez-vous.
              </li>
              <li>
                Créez une clé API dans votre projet/organisation. Vérifiez le
                modèle accessible et les limites de votre compte.
              </li>
              <li>
                Collez la clé ci-dessus. Vous pourrez la remplacer ou la
                supprimer.
              </li>
            </ol>
            <p>
              La connexion à Tarjama ne crée aucune clé API. Plusieurs clés du
              même projet ou de la même organisation ne multiplient pas sa
              capacité.
            </p>
          </details>
        </section>
      ))}
      <p role="status">{message}</p>
    </section>
  );
}
