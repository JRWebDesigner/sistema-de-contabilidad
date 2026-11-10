"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole, LogIn, UserPlus } from "lucide-react";

export default function LoginPage() {
  const [setup, setSetup] = useState(false);
  const [form, setForm] = useState({
    name: "",
    alias: "",
    identifier: "",
    password: "",
  });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const payload = setup
      ? {
          name: form.name.trim(),
          alias: form.alias.trim(),
          identifier: form.identifier.trim(),
          password: form.password,
        }
      : {
          identifier: form.identifier.trim(),
          password: form.password,
        };

    const response = await fetch("/api/auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth-action": setup ? "setup" : "login",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage(data.error ?? "No se pudo iniciar sesión.");
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <span className="brand-mark">
          <LockKeyhole size={20} />
        </span>
        <p className="eyebrow">Businessman S.R.L.</p>
        <h1>{setup ? "Crear administrador" : "Iniciar sesión"}</h1>
        <p className="muted">
          {setup
            ? "Configura el primer acceso seguro del sistema."
            : "Ingresa con tu correo o alias."}
        </p>
        <form onSubmit={submit}>
          {setup && (
            <label>
              Nombre
              <input
                required
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>
          )}
          {setup && (
            <label>
              Alias
              <input
                required
                minLength={3}
                pattern="[A-Za-z0-9._-]+"
                value={form.alias}
                onChange={(event) =>
                  setForm({ ...form, alias: event.target.value })
                }
                placeholder="Ej. fernando"
              />
            </label>
          )}
          <label>
            {setup ? "Correo" : "Correo o alias"}
            <input
              required
              type={setup ? "email" : "text"}
              value={form.identifier}
              onChange={(event) =>
                setForm({ ...form, identifier: event.target.value })
              }
            />
          </label>
          <label>
            Contraseña
            <input
              required
              minLength={8}
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
            />
          </label>
          {message && <p className="module-message">{message}</p>}
          <button
            className="primary-button auth-submit"
            type="submit"
            disabled={loading}
          >
            {setup ? <UserPlus size={16} /> : <LogIn size={16} />}
            {loading
              ? "Procesando..."
              : setup
                ? "Crear administrador"
                : "Entrar"}
          </button>
        </form>
        <button
          className="auth-switch"
          onClick={() => {
            setSetup(!setup);
            setMessage("");
          }}
        >
          {setup ? "Ya tengo una cuenta" : "Crear el primer administrador"}
        </button>
      </section>
    </main>
  );
}
