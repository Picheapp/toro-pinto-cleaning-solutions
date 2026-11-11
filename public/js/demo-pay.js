// Demo payment page (only reachable when Stripe is not configured and demo payments are enabled).
const msg = document.getElementById('msg');
const TX = { en: { ok: 'Payment successful. Redirecting…', fail: 'Payment failed.', err: 'Something went wrong.' }, es: { ok: 'Pago exitoso. Redirigiendo…', fail: 'El pago falló.', err: 'Algo salió mal.' } };
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-ref]'); if (!b) return;
  const tx = TX[b.dataset.lang] || TX.en; document.querySelectorAll('button[data-ref]').forEach((x) => { x.disabled = true; });
  try {
    const r = await fetch('/api/pay/demo/' + encodeURIComponent(b.dataset.ref), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, credentials: 'same-origin', body: JSON.stringify({ result: b.dataset.result }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || tx.err);
    msg.hidden = false; msg.textContent = j.status === 'succeeded' ? tx.ok : tx.fail;
    setTimeout(() => { location.href = j.status === 'succeeded' ? '/?paid=1#account' : '/?paid=0#account'; }, 900);
  } catch (err) { msg.hidden = false; msg.textContent = err.message; document.querySelectorAll('button[data-ref]').forEach((x) => { x.disabled = false; }); }
});
