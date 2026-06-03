// Paddle.js checkout overlay loader. Initialized lazily from the pay config in /api/me. The webhook
// is the source of truth for granting access; the overlay's completion event just refreshes the UI.
let initP = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the checkout — check your connection.'));
    document.head.append(s);
  });
}

async function ensurePaddle(pay) {
  if (!initP) {
    initP = loadScript('https://cdn.paddle.com/paddle/v2/paddle.js').then(() => {
      window.Paddle.Environment.set(pay.env === 'production' ? 'production' : 'sandbox');
      window.Paddle.Initialize({
        token: pay.clientToken,
        eventCallback: (ev) => { if (ev && ev.name === 'checkout.completed') window.dispatchEvent(new CustomEvent('sf:paid')); },
      });
    });
  }
  await initP;
  return window.Paddle;
}

// Open the Paddle checkout overlay for a price. customData is passed through to our /paddle/webhook.
export async function paddleCheckout(pay, { priceId, email, customData }) {
  const Paddle = await ensurePaddle(pay);
  Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: email ? { email } : undefined,
    customData,
    settings: { theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' },
  });
}
